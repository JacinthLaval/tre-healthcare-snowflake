import os
import json
import logging
import threading
import time
from flask import Flask, request, jsonify
import snowflake.connector

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_pg_heartbeat_lock = threading.Lock()
_pg_last_heartbeat = 0
PG_HEARTBEAT_INTERVAL = 60

SF_HOST = os.getenv('SNOWFLAKE_HOST', '')
SF_ACCOUNT = os.getenv('SNOWFLAKE_ACCOUNT', '')
SF_DATABASE = 'TRE_HEALTHCARE_DB'
SF_SCHEMA = 'FHIR_STAGING'
SF_WAREHOUSE = 'SI_DEMO_WH'

PG_HOST = os.getenv('PG_HOST', '')
PG_PORT = int(os.getenv('PG_PORT', '5432'))
PG_DATABASE = os.getenv('PG_DATABASE', 'postgres')
PG_USER = os.getenv('PG_USER', 'snowflake_admin')
PG_PASSWORD = os.getenv('PG_PASSWORD', '')
PG_SSLMODE = os.getenv('PG_SSLMODE', 'require')
PG_SSLROOTCERT = os.getenv('PG_SSLROOTCERT', '')

pg_conn_pool = None


def get_sf_token():
    with open('/snowflake/session/token', 'r') as f:
        return f.read().strip()


def get_sf_connection():
    params = {
        'token': get_sf_token(),
        'authenticator': 'oauth',
        'database': SF_DATABASE,
        'schema': SF_SCHEMA,
        'warehouse': SF_WAREHOUSE,
    }
    if SF_HOST:
        params['host'] = SF_HOST
    if SF_ACCOUNT:
        params['account'] = SF_ACCOUNT
    return snowflake.connector.connect(**params)


def get_pg_connection():
    import psycopg2
    _send_pg_heartbeat()
    params = {
        'host': PG_HOST,
        'port': PG_PORT,
        'dbname': PG_DATABASE,
        'user': PG_USER,
        'password': PG_PASSWORD,
        'sslmode': PG_SSLMODE,
    }
    if PG_SSLROOTCERT:
        params['sslrootcert'] = PG_SSLROOTCERT
    try:
        return psycopg2.connect(**params, connect_timeout=5)
    except psycopg2.OperationalError:
        logger.info("PG connection failed — attempting auto-resume")
        _try_pg_resume()
        return psycopg2.connect(**params, connect_timeout=30)


def _send_pg_heartbeat():
    global _pg_last_heartbeat
    now = time.time()
    with _pg_heartbeat_lock:
        if now - _pg_last_heartbeat < PG_HEARTBEAT_INTERVAL:
            return
        _pg_last_heartbeat = now
    try:
        conn = get_sf_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO TRE_HEALTHCARE_DB.FHIR_STAGING.PG_ACTIVITY_LOG "
            "VALUES (CURRENT_TIMESTAMP(), 'SPCS_HEARTBEAT')"
        )
        conn.close()
    except Exception as e:
        logger.warning(f"Heartbeat write failed: {e}")


def _try_pg_resume():
    try:
        conn = get_sf_connection()
        cur = conn.cursor()
        cur.execute("CALL TRE_HEALTHCARE_DB.FHIR_STAGING.PG_AUTO_RESUME()")
        result = cur.fetchone()
        conn.close()
        logger.info(f"PG auto-resume result: {result[0] if result else 'unknown'}")
        for _ in range(12):
            time.sleep(5)
            conn2 = get_sf_connection()
            cur2 = conn2.cursor()
            cur2.execute("SHOW POSTGRES INSTANCES LIKE 'FHIR_INGESTION_PG'")
            row = cur2.fetchone()
            conn2.close()
            if row:
                state_idx = [d[0] for d in cur2.description].index('state')
                if row[state_idx] == 'READY':
                    logger.info("PG resumed and READY")
                    return
        logger.warning("PG resume timed out after 60s")
    except Exception as e:
        logger.error(f"PG auto-resume failed: {e}")


@app.route('/api/v2/statements', methods=['POST'])
def execute_sql():
    body = request.json
    sql = body.get('statement', '')
    if not sql:
        return jsonify({'error': 'No statement provided'}), 400

    blocked = ['DROP ', 'TRUNCATE ', 'DELETE ', 'ALTER ', 'CREATE ', 'INSERT ', 'UPDATE ', 'GRANT ', 'REVOKE ']
    sql_upper = sql.strip().upper()
    for kw in blocked:
        if sql_upper.startswith(kw):
            return jsonify({'error': f'Statement type not allowed: {kw.strip()}'}), 403

    conn = get_sf_connection()
    try:
        cur = conn.cursor()
        cur.execute(sql)
        cols = [desc[0] for desc in cur.description] if cur.description else []
        rows = cur.fetchall()
        data = [[str(v) if v is not None else None for v in row] for row in rows]
        return jsonify({
            'resultSetMetaData': {'rowType': [{'name': c} for c in cols]},
            'data': data,
            'code': '090001',
            'message': 'Statement executed successfully.',
        })
    except Exception as e:
        logger.error(f"SF SQL error: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/pg/query', methods=['POST'])
def pg_query():
    body = request.json
    sql = body.get('sql', '')
    params = body.get('params', [])
    if not sql:
        return jsonify({'error': 'No sql provided'}), 400

    conn = get_pg_connection()
    try:
        cur = conn.cursor()
        cur.execute(sql, params or None)

        if cur.description:
            cols = [desc[0] for desc in cur.description]
            rows = cur.fetchall()
            data = [[str(v) if v is not None else None for v in row] for row in rows]
            conn.commit()
            return jsonify({'columns': cols, 'data': data})
        else:
            affected = cur.rowcount
            conn.commit()
            return jsonify({'columns': [], 'data': [], 'rowsAffected': affected})
    except Exception as e:
        conn.rollback()
        logger.error(f"PG error: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/pg/execute', methods=['POST'])
def pg_execute():
    body = request.json
    sql = body.get('sql', '')
    params = body.get('params', [])
    if not sql:
        return jsonify({'error': 'No sql provided'}), 400

    conn = get_pg_connection()
    try:
        cur = conn.cursor()
        cur.execute(sql, params or None)
        affected = cur.rowcount
        conn.commit()
        return jsonify({'success': True, 'rowsAffected': affected})
    except Exception as e:
        conn.rollback()
        logger.error(f"PG execute error: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/health', methods=['GET'])
def health():
    result = {'snowflake': 'unknown', 'postgres': 'unknown'}

    try:
        conn = get_sf_connection()
        cur = conn.cursor()
        cur.execute('SELECT CURRENT_USER(), CURRENT_ROLE()')
        row = cur.fetchone()
        conn.close()
        result['snowflake'] = 'ok'
        result['sf_user'] = row[0]
        result['sf_role'] = row[1]
    except Exception as e:
        result['snowflake'] = f'error: {str(e)[:100]}'

    if PG_HOST:
        try:
            conn = get_sf_connection()
            cur = conn.cursor()
            cur.execute("SHOW POSTGRES INSTANCES LIKE 'FHIR_INGESTION_PG'")
            row = cur.fetchone()
            cols = [d[0] for d in cur.description]
            state_idx = cols.index('state')
            pg_state = row[state_idx] if row else 'UNKNOWN'
            conn.close()
            result['pg_instance_state'] = pg_state
        except Exception:
            pass

        try:
            conn = get_pg_connection()
            cur = conn.cursor()
            cur.execute('SELECT version()')
            row = cur.fetchone()
            conn.close()
            result['postgres'] = 'ok'
            result['pg_version'] = row[0][:50] if row else 'unknown'
        except Exception as e:
            result['postgres'] = f'error: {str(e)[:100]}'
    else:
        result['postgres'] = 'not configured'

    return jsonify(result)


@app.route('/api/pg/resume', methods=['POST'])
def pg_resume():
    try:
        _try_pg_resume()
        return jsonify({'success': True, 'message': 'Resume initiated'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/ingest/fhir', methods=['POST'])
def ingest_fhir():
    body = request.json
    bundle = body.get('bundle')
    source_system = body.get('source_system', 'UNKNOWN')

    if not bundle:
        return jsonify({'error': 'No bundle provided'}), 400

    if PG_HOST:
        conn = get_pg_connection()
        try:
            cur = conn.cursor()
            resource_count = len(bundle.get('entry', []))
            quality_tier = 'unknown'
            tags = bundle.get('meta', {}).get('tag', [])
            for tag in tags:
                if tag.get('system') == 'http://test.org/quality-tier':
                    quality_tier = tag.get('code', 'unknown')

            cur.execute(
                """INSERT INTO fhir_staging.raw_bundles
                   (source_system, quality_tier, bundle_data, resource_count)
                   VALUES (%s, %s, %s, %s)
                   RETURNING bundle_id""",
                (source_system, quality_tier, json.dumps(bundle), resource_count)
            )
            bundle_id = cur.fetchone()[0]
            conn.commit()
            return jsonify({'success': True, 'bundle_id': bundle_id, 'resource_count': resource_count})
        except Exception as e:
            conn.rollback()
            return jsonify({'error': str(e)}), 500
        finally:
            conn.close()
    else:
        return jsonify({'error': 'Postgres not configured for streaming ingestion'}), 503


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8085)
