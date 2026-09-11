import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { createWorkoutDiaryStore } from './workoutDiary';
import { readWorkoutDiary, saveWorkoutDiary, finishWorkoutDiary } from '@/db/workoutDiary';
import type Session from '@/db/models/Session';

async function seed(db: ReturnType<typeof createTestDatabase>, id = 'finished') {
  await db.write(() => db.get('sessions').create((row: any) => {
    row._raw.id = id; row._raw.routine_id = 'routine';
    row._raw.started_at = 1; row._raw.ended_at = id === 'active' ? null : 2;
    row._raw.created_at = 1;
  }));
}

it('persists the diary before offering an optional selfie, survives reopening, and skips without file I/O', async () => {
 const db = createTestDatabase();
 try {
  await seed(db);
  const files = { copy: jest.fn(), remove: jest.fn() };
  const store = createWorkoutDiaryStore(db, 'finished', files);
  await store.getState().load();
  expect(store.getState().stage).toBe('diary');
  expect(await store.getState().saveDiary('   ')).toBe(false);
  expect(await store.getState().complete(null)).toBe(false);
  expect(await store.getState().saveDiary(' Felt strong\nSlept well ')).toBe(true);
  expect(store.getState().stage).toBe('selfie');
  const reopened = createWorkoutDiaryStore(db, 'finished', files);
  await reopened.getState().load();
  expect(reopened.getState().stage).toBe('selfie');
  expect(reopened.getState().diary).toBe('Felt strong\nSlept well');
  expect(await reopened.getState().complete(null)).toBe(true);
  expect(files.copy).not.toHaveBeenCalled();
  expect(await readWorkoutDiary(db, 'finished')).toEqual({ diary: 'Felt strong\nSlept well', selfiePath: null, ready: true });
  await store.getState().load();
  expect(store.getState().stage).toBe('ready');
 } finally { await closeTestDatabase(db); }
});

it('copies a selfie to owned storage before persisting completion and refuses double submission', async () => {
 const db=createTestDatabase();
 try {
  await seed(db); await saveWorkoutDiary(db,'finished','Diary');
  let release!: (value: string) => void;
  const copy=jest.fn(() => new Promise<string>(resolve => { release=resolve; }));
  const store=createWorkoutDiaryStore(db,'finished',{ copy, remove:jest.fn() });
  await store.getState().load();
  const saving=store.getState().complete('file:///cache/selfie.jpg');
  expect(await store.getState().complete(null)).toBe(false);
  expect((await readWorkoutDiary(db,'finished')).ready).toBe(false);
  release('workout-selfies/owned.jpg');
  expect(await saving).toBe(true);
  expect(copy).toHaveBeenCalledWith('file:///cache/selfie.jpg');
  expect(await readWorkoutDiary(db,'finished')).toEqual({ diary:'Diary', selfiePath:'workout-selfies/owned.jpg', ready:true });
 } finally { await closeTestDatabase(db); }
});

it('keeps the diary recoverable on copy or DB failure and removes only the failed new copy', async () => {
 const db=createTestDatabase();
 try {
  await seed(db); await saveWorkoutDiary(db,'finished','Keep me');
  const remove=jest.fn().mockRejectedValue(new Error('cleanup failed'));
  const copy=jest.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue('workout-selfies/new.jpg');
  const store=createWorkoutDiaryStore(db,'finished',{copy,remove});
  await store.getState().load();
  expect(await store.getState().complete('file:///cache/a.jpg')).toBe(false);
  expect(store.getState().stage).toBe('selfie');
  expect(remove).not.toHaveBeenCalled();
  const row=await db.get<Session>('sessions').find('finished');
  const update=jest.spyOn(row,'update').mockRejectedValueOnce(new Error('DB unavailable'));
  expect(await store.getState().complete('file:///cache/a.jpg')).toBe(false);
  update.mockRestore();
  expect(remove).toHaveBeenCalledWith('workout-selfies/new.jpg');
  expect(store.getState().error).toBe('Could not save your selfie. Your diary is saved. Try again or skip.');
  expect(await readWorkoutDiary(db,'finished')).toEqual({diary:'Keep me',selfiePath:null,ready:false});
 } finally { await closeTestDatabase(db); }
});

it('rejects active workouts and unsafe persisted selfie paths', async () => {
 const db=createTestDatabase();
 try {
  await seed(db,'active'); await seed(db);
  await expect(saveWorkoutDiary(db,'active','Diary')).rejects.toThrow('finished');
  await expect(finishWorkoutDiary(db,'finished',null)).rejects.toThrow('diary');
  await saveWorkoutDiary(db,'finished','Diary');
  for (const path of ['file:///cache/a.jpg','/absolute.jpg','../other.jpg','workout-selfies/../other.jpg']) {
   await expect(finishWorkoutDiary(db,'finished',path)).rejects.toThrow('path');
  }
  expect((await readWorkoutDiary(db,'finished')).ready).toBe(false);
 } finally { await closeTestDatabase(db); }
});

it('lets only the first of two mounted gates finish and cleans the losing selfie', async () => {
 const db=createTestDatabase();
 try {
  await seed(db); await saveWorkoutDiary(db,'finished','Original diary');
  const filesA={copy:jest.fn().mockResolvedValue('workout-selfies/winner.jpg'),remove:jest.fn()};
  const filesB={copy:jest.fn().mockResolvedValue('workout-selfies/loser.jpg'),remove:jest.fn()};
  const a=createWorkoutDiaryStore(db,'finished',filesA),b=createWorkoutDiaryStore(db,'finished',filesB);
  await a.getState().load();await b.getState().load();
  expect(await Promise.all([a.getState().complete('file:///a.jpg'),b.getState().complete('file:///b.jpg')])).toEqual([true,false]);
  expect(filesA.remove).not.toHaveBeenCalled();
  expect(filesB.remove).toHaveBeenCalledWith('workout-selfies/loser.jpg');
  expect(await readWorkoutDiary(db,'finished')).toEqual({diary:'Original diary',selfiePath:'workout-selfies/winner.jpg',ready:true});
  await expect(saveWorkoutDiary(db,'finished','Late edit')).rejects.toThrow('completed');
  await b.getState().load();expect(b.getState().stage).toBe('ready');
 } finally {await closeTestDatabase(db);}
});
