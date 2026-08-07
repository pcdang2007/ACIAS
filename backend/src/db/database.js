'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA } = require('./schema');
const config = require('../config');

const DATA_DIR = config.dataDir;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

let db = null;

function getDb() {
  if (db) return db;
  ensureDataDir();
  db = new DatabaseSync(path.join(DATA_DIR, 'acias.db'));
  db.exec(SCHEMA);
  return db;
}

function rows(sql, params = []) {
  const stmt = getDb().prepare(sql);
  return stmt.all(...params.map((p) => (p === undefined ? null : p)));
}

function row(sql, params = []) {
  const stmt = getDb().prepare(sql);
  return stmt.get(...params.map((p) => (p === undefined ? null : p)));
}

function run(sql, params = []) {
  const stmt = getDb().prepare(sql);
  const result = stmt.run(...params.map((p) => (p === undefined ? null : p)));
  return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
}

function transaction(fn) {
  const database = getDb();
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

function now() {
  return new Date().toISOString();
}

module.exports = { getDb, rows, row, run, transaction, now, DATA_DIR };
