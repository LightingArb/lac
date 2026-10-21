"""Database connections and bounded writes; contains no market rules."""

import os
import re
from pathlib import Path

import psycopg
from psycopg import sql


def h_connect(database: str | None = None, autocommit: bool = False) -> psycopg.Connection:
    required = ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD")
    if any(not os.environ.get(k) for k in required):
        raise RuntimeError("Load the project root environment before starting")
    if os.environ["DB_NAME"] != "lac_data" or os.environ["DB_PORT"] != "5432":
        raise RuntimeError("Expected local lac_data on port 5432")
    connection = psycopg.connect(
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"],
        dbname=database or os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        connect_timeout=10,
        autocommit=autocommit,
    )
    if connection.info.server_version // 10000 != 16:
        connection.close()
        raise RuntimeError("Expected PostgreSQL 16")
    return connection


def h_setup(schema: str, directory: Path) -> None:
    """Create missing declared objects; reject name/type differences without migration."""
    with h_connect("postgres", autocommit=True) as connection:
        connection.execute("SELECT pg_advisory_lock(7165432)")
        try:
            exists = connection.execute(
                "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = %s)", ("lac_data",)
            ).fetchone()[0]
            if not exists:
                connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier("lac_data")))
        finally:
            connection.execute("SELECT pg_advisory_unlock(7165432)")
    statements = [
        s.strip()
        for p in sorted(directory.glob("*.sql"))
        for s in p.read_text().split(";")
        if s.strip()
    ]
    declared = {}
    for statement in statements:
        match = re.match(r"CREATE TABLE (\w+)\.(\w+)\s*\((.*)\)$", statement, re.DOTALL)
        if match:
            columns = {}
            for line in match[3].splitlines():
                column = re.match(
                    r'\s*"?([a-z][a-z0-9_]*)"?\s+(TEXT|NUMERIC|INTEGER|BOOLEAN|JSONB|TIMESTAMPTZ)\b',
                    line,
                )
                if column:
                    kind = column[2].lower()
                    columns[column[1]] = {"timestamptz": "timestamp with time zone"}.get(kind, kind)
            declared[match[2]] = columns
    with h_connect() as connection:
        connection.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(schema)))
        existing = {
            r[0]
            for r in connection.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = %s AND table_type = 'BASE TABLE'",
                (schema,),
            )
        }
        if existing - declared.keys():
            raise RuntimeError(
                f"Unexpected tables in {schema}: {sorted(existing - declared.keys())}"
            )
        for table in existing:
            actual = dict(
                connection.execute(
                    "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = %s AND table_name = %s",
                    (schema, table),
                ).fetchall()
            )
            if actual != declared[table]:
                raise RuntimeError(
                    f"Schema mismatch: {schema}.{table}: expected {declared[table]}, got {actual}"
                )
        for statement in statements:
            match = re.match(r"CREATE TABLE \w+\.(\w+)", statement)
            index = re.search(r"CREATE INDEX \w+ ON \w+\.(\w+)", statement)
            if match and match[1] not in existing or index and index[1] not in existing:
                connection.execute(statement)
    print(f"SETUP_OK {schema} tables={len(declared)}", flush=True)


def h_upsert(
    connection: psycopg.Connection, insert: str, conflict: str, rows: list[tuple], batch_size: int
) -> None:
    """One parameterized statement per bounded group; identifiers are caller literals."""
    for start in range(0, len(rows), batch_size):
        batch = rows[start : start + batch_size]
        placeholders = "(" + ",".join(["%s"] * len(batch[0])) + ")"
        connection.execute(
            insert + ",".join([placeholders] * len(batch)) + conflict,
            [value for row in batch for value in row],
        )
