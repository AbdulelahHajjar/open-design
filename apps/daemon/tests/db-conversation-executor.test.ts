import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import {
  closeDatabase,
  getConversation,
  insertConversation,
  insertProject,
  listConversations,
  openDatabase,
  updateConversation,
} from '../src/db.js';

/**
 * Storage contract for `conversations.executor_json`: a database written
 * before the column existed upgrades in place, its rows read back with no
 * executor, and a stored value that no longer parses is treated as absent
 * rather than surfacing a malformed executor or failing the read.
 */

let tempDirs: string[] = [];

afterEach(() => {
  closeDatabase();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function tempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `od-conv-executor-${label}-`));
  tempDirs.push(dir);
  return dir;
}

function columnNames(db: InstanceType<typeof Database>, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
}

function seedLegacyDatabase(dir: string): void {
  const db = new Database(path.join(dir, 'app.sqlite'));
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    INSERT INTO projects VALUES ('project-1', 'Project', 1, 1);
    INSERT INTO conversations VALUES ('conversation-1', 'project-1', 'Chat', 1, 1);
  `);
  db.close();
}

describe('conversations.executor_json', () => {
  it('is added to a legacy database, whose rows read back with no executor', () => {
    const dir = tempDir('legacy');
    seedLegacyDatabase(dir);

    const db = openDatabase(dir, { dataDir: dir });

    expect(columnNames(db, 'conversations')).toContain('executor_json');
    const conversation = getConversation(db, 'conversation-1');
    expect(conversation?.title, 'legacy row absent — this is a fresh database').toBe('Chat');
    expect(conversation && 'executor' in conversation).toBe(false);
    const listed = listConversations(db, 'project-1');
    expect(listed).toHaveLength(1);
    expect('executor' in listed[0]!).toBe(false);
  });

  it('round-trips an executor through insert and update, and clears it with null', () => {
    const dir = tempDir('roundtrip');
    const db = openDatabase(dir, { dataDir: dir });
    insertProject(db, { id: 'p', name: 'P', createdAt: 1, updatedAt: 1 });
    const executor = { mode: 'daemon', agentId: 'codex', agentModel: { model: 'gpt-5.5' } };

    const inserted = insertConversation(db, {
      id: 'c', projectId: 'p', title: null, executor, createdAt: 1, updatedAt: 1,
    });
    expect(inserted?.executor).toEqual(executor);
    expect(listConversations(db, 'p')[0]?.executor).toEqual(executor);

    const renamed = updateConversation(db, 'c', { title: 'Renamed' });
    expect(renamed?.executor).toEqual(executor);

    const byok = { mode: 'api', apiProtocol: 'anthropic' };
    expect(updateConversation(db, 'c', { executor: byok })?.executor).toEqual(byok);

    const cleared = updateConversation(db, 'c', { executor: null });
    expect(cleared && 'executor' in cleared).toBe(false);
    const row = db.prepare(`SELECT executor_json AS executorJson FROM conversations WHERE id = ?`)
      .get('c') as { executorJson: unknown };
    expect(row.executorJson).toBeNull();
  });

  it.each([
    ['corrupt JSON', '{not json'],
    ['a value that no longer parses as an executor', '{"mode":"remote","agentId":"x"}'],
    ['JSON null', 'null'],
  ])('reads %s as no executor', (_label, stored) => {
    const dir = tempDir('corrupt');
    const db = openDatabase(dir, { dataDir: dir });
    insertProject(db, { id: 'p', name: 'P', createdAt: 1, updatedAt: 1 });
    insertConversation(db, { id: 'c', projectId: 'p', title: null, createdAt: 1, updatedAt: 1 });
    db.prepare(`UPDATE conversations SET executor_json = ? WHERE id = ?`).run(stored, 'c');

    const conversation = getConversation(db, 'c');
    expect(conversation?.id).toBe('c');
    expect(conversation && 'executor' in conversation).toBe(false);
    expect('executor' in listConversations(db, 'p')[0]!).toBe(false);
  });
});
