from pathlib import Path

from h_shared.h_db import h_setup


def all_setup() -> None:
    h_setup("m_live", Path(__file__).parent / "sql")


if __name__ == "__main__":
    all_setup()
