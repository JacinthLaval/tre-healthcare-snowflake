# Snowflake Connection Helper for HADES
# Pre-configured for TRE Healthcare OMOP CDM

library(DatabaseConnector)

# Create Snowflake connection details
createSnowflakeConnectionDetails <- function(
  account = "SFSEHOL-SI_INDUSTRY_DEMOS_HEALTHCARE_LMSZKS",
  warehouse = "COMPUTE_WH",
  database = "TRE_HEALTHCARE_DB",
  schema = "OMOP_CDM",
  user = NULL,
  password = NULL
) {
  
  # Use environment variables if credentials not provided
  if (is.null(user)) user <- Sys.getenv("SNOWFLAKE_USER")
  if (is.null(password)) password <- Sys.getenv("SNOWFLAKE_PASSWORD")
  
  connectionString <- sprintf(
    "jdbc:snowflake://%s.snowflakecomputing.com/?warehouse=%s&db=%s&schema=%s",
    account, warehouse, database, schema
  )
  
  createConnectionDetails(
    dbms = "snowflake",
    connectionString = connectionString,
    user = user,
    password = password,
    pathToDriver = "/opt/hades/jdbc_drivers"
  )
}

# Quick connection test
testSnowflakeConnection <- function(connectionDetails) {
  conn <- connect(connectionDetails)
  result <- querySql(conn, "SELECT CURRENT_ACCOUNT() as ACCOUNT, CURRENT_DATABASE() as DB, CURRENT_SCHEMA() as SCHEMA")
  disconnect(conn)
  return(result)
}

# List available OMOP CDM tables
listOmopTables <- function(connectionDetails) {
  conn <- connect(connectionDetails)
  result <- querySql(conn, "
    SELECT TABLE_NAME, ROW_COUNT 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_SCHEMA = 'OMOP_CDM'
    ORDER BY TABLE_NAME
  ")
  disconnect(conn)
  return(result)
}

# CDM schema paths for HADES packages
getCdmSchemaSettings <- function() {
  list(
    cdmDatabaseSchema = "TRE_HEALTHCARE_DB.OMOP_CDM",
    cohortDatabaseSchema = "TRE_HEALTHCARE_DB.OMOP_CDM",
    resultsDatabaseSchema = "TRE_HEALTHCARE_DB.OMOP_CDM",
    vocabDatabaseSchema = "TRE_HEALTHCARE_DB.OMOP_CDM"
  )
}

cat("Snowflake connection helper loaded.\n")
cat("Usage:\n")
cat("  connectionDetails <- createSnowflakeConnectionDetails(user='YOUR_USER', password='YOUR_PASS')\n")
cat("  testSnowflakeConnection(connectionDetails)\n")
cat("  listOmopTables(connectionDetails)\n")
