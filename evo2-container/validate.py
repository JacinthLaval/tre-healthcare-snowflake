"""Validate server.py structure without GPU dependencies."""
import ast
import sys

with open("/app/server.py") as f:
    source = f.read()

try:
    tree = ast.parse(source)
except SyntaxError as e:
    print(f"FAIL: Syntax error in server.py: {e}")
    sys.exit(1)

endpoints = []
for node in ast.walk(tree):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        for decorator in node.decorator_list:
            func = None
            args = []
            if isinstance(decorator, ast.Call):
                func = decorator.func
                args = decorator.args
            elif isinstance(decorator, ast.Attribute):
                func = decorator
            if func and isinstance(func, ast.Attribute):
                method = func.attr
                if method in ("get", "post", "put", "delete"):
                    path = args[0].value if args and isinstance(args[0], ast.Constant) else "/" + node.name
                    endpoints.append(f"{method.upper()} {path}")

print("server.py syntax: OK")
print(f"Endpoints found: {len(endpoints)}")
for ep in endpoints:
    print(f"  - {ep}")

with open("/app/quantize.py") as f:
    source2 = f.read()

try:
    ast.parse(source2)
    print("quantize.py syntax: OK")
except SyntaxError as e:
    print(f"FAIL: Syntax error in quantize.py: {e}")
    sys.exit(1)

expected = ["GET /health", "POST /score", "POST /generate", "POST /embeddings", "POST /variant-score"]
for ep in expected:
    if ep in endpoints:
        print(f"  ✓ {ep}")
    else:
        print(f"  ✗ MISSING: {ep}")
        sys.exit(1)

print("\nAll validations passed!")
