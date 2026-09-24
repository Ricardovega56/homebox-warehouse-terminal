"""
Companion Database Module — SQLite storage for Par Levels, Shopping Lists,
Cycle Count Audits, and Meal/Kit Bill of Materials.
"""

import os
import sqlite3
from typing import List, Dict, Any, Optional

DB_PATH = os.environ.get("COMPANION_DB_PATH", "/data/companion.db" if os.path.isdir("/data") else "companion.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_connection() as conn:
        cursor = conn.cursor()
        
        # Par Levels / Reorder Policies
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS par_levels (
            entity_id TEXT PRIMARY KEY,
            min_quantity REAL NOT NULL DEFAULT 1.0,
            target_quantity REAL NOT NULL DEFAULT 5.0,
            unit TEXT DEFAULT 'pcs',
            supplier_url TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # Shopping List Items
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS shopping_list (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_id TEXT,
            name TEXT NOT NULL,
            quantity_needed REAL NOT NULL DEFAULT 1.0,
            unit TEXT DEFAULT 'pcs',
            category TEXT DEFAULT 'General',
            completed BOOLEAN DEFAULT 0,
            source TEXT DEFAULT 'manual',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # Cycle Count Audit Sessions
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS cycle_counts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            location_id TEXT NOT NULL,
            location_name TEXT NOT NULL,
            items_expected INTEGER NOT NULL,
            items_verified INTEGER NOT NULL,
            discrepancies INTEGER NOT NULL,
            notes TEXT,
            completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # Recipe / Assembly Kits (BOM)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS recipes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT DEFAULT 'Dinner',
            instructions TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS recipe_ingredients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
            entity_id TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 1.0,
            unit TEXT DEFAULT 'pcs'
        );
        """)
        conn.commit()

# Par Levels Operations
def get_all_par_levels() -> List[Dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM par_levels ORDER BY updated_at DESC").fetchall()
        return [dict(r) for r in rows]

def set_par_level(entity_id: str, min_qty: float, target_qty: float, unit: str = "pcs", supplier_url: Optional[str] = None):
    with get_connection() as conn:
        conn.execute("""
        INSERT INTO par_levels (entity_id, min_quantity, target_quantity, unit, supplier_url, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(entity_id) DO UPDATE SET
            min_quantity = excluded.min_quantity,
            target_quantity = excluded.target_quantity,
            unit = excluded.unit,
            supplier_url = excluded.supplier_url,
            updated_at = CURRENT_TIMESTAMP
        """, (entity_id, min_qty, target_qty, unit, supplier_url))
        conn.commit()

def delete_par_level(entity_id: str):
    with get_connection() as conn:
        conn.execute("DELETE FROM par_levels WHERE entity_id = ?", (entity_id,))
        conn.commit()

# Shopping List Operations
def get_shopping_items() -> List[Dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM shopping_list ORDER BY completed ASC, created_at DESC").fetchall()
        return [dict(r) for r in rows]

def add_shopping_item(name: str, quantity_needed: float = 1.0, unit: str = "pcs", entity_id: Optional[str] = None, source: str = "manual") -> int:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO shopping_list (name, quantity_needed, unit, entity_id, source)
        VALUES (?, ?, ?, ?, ?)
        """, (name, quantity_needed, unit, entity_id, source))
        conn.commit()
        return cursor.lastrowid

def update_shopping_item(item_id: int, completed: bool):
    with get_connection() as conn:
        conn.execute("UPDATE shopping_list SET completed = ? WHERE id = ?", (1 if completed else 0, item_id))
        conn.commit()

def delete_shopping_item(item_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM shopping_list WHERE id = ?", (item_id,))
        conn.commit()

def clear_completed_shopping_items():
    with get_connection() as conn:
        conn.execute("DELETE FROM shopping_list WHERE completed = 1")
        conn.commit()

# Cycle Count Operations
def record_cycle_count(location_id: str, location_name: str, items_expected: int, items_verified: int, discrepancies: int, notes: Optional[str] = None) -> int:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO cycle_counts (location_id, location_name, items_expected, items_verified, discrepancies, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (location_id, location_name, items_expected, items_verified, discrepancies, notes))
        conn.commit()
        return cursor.lastrowid

def get_recent_cycle_counts(limit: int = 50) -> List[Dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM cycle_counts ORDER BY completed_at DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]
