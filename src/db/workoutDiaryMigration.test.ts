import { databaseSchema } from './schema';
import { migrations } from './migrations';
import { stepsForMigration } from '@nozbe/watermelondb/Schema/migrations/stepsForMigration';

it('adds nullable diary, local selfie and completion columns through a covered v9 upgrade', () => {
 const expected = [
  {name:'diary_entry',type:'string',isOptional:true},
  {name:'selfie_path',type:'string',isOptional:true},
  {name:'debrief_ready',type:'boolean',isOptional:true},
 ];
 expect(databaseSchema.version).toBe(10);
 for (const column of expected) expect(databaseSchema.tables.sessions.columns[column.name]).toMatchObject(column);
 const steps=stepsForMigration({migrations,fromVersion:9,toVersion:10});
 expect(steps).toEqual([expect.objectContaining({type:'add_columns',table:'sessions',columns:expected})]);
});

import { Database, appSchema, tableSchema } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import Routine from './models/Routine';
import Exercise from './models/Exercise';
import RoutineExercise from './models/RoutineExercise';
import RoutineSet from './models/RoutineSet';
import Session from './models/Session';
import SessionSet from './models/SessionSet';
import { saveWorkoutDiary, finishWorkoutDiary, readWorkoutDiary } from './workoutDiary';
const LokiMemoryAdapter = require('lokijs').LokiMemoryAdapter;

it('retains an existing workout and its logged set through a real v9-to-v10 reopen', async () => {
 const memory = new LokiMemoryAdapter();
 const oldSchema=appSchema({ version:9, tables:Object.values(databaseSchema.tables).map(table=>tableSchema({
  name:table.name, columns:table.columnArray.filter(c=>table.name!=='sessions'||!['diary_entry','selfie_path','debrief_ready'].includes(c.name)),
 })) });
 const open=(schema:typeof databaseSchema,upgrade=false)=>new Database({
  adapter:new LokiJSAdapter({dbName:'diary-upgrade',schema,migrations:upgrade?migrations:undefined,
   useWebWorker:false,useIncrementalIndexedDB:false,_testLokiAdapter:memory,extraLokiOptions:{autosave:false}} as never),
  modelClasses:[Routine,Exercise,RoutineExercise,RoutineSet,Session,SessionSet],
 });
 const close=async(db:Database)=>{
  const loki=(db.adapter as any).underlyingAdapter._driver.loki;
  await new Promise<void>((resolve,reject)=>loki.saveDatabase((e:Error)=>e?reject(e):resolve()));
  await new Promise<void>(resolve=>loki.close(resolve));
 };
 const old=open(oldSchema);
 await old.write(async()=>{
  await old.get('sessions').create((r:any)=>Object.assign(r._raw,{id:'kept',routine_id:'routine',started_at:10,ended_at:20,created_at:10}));
  await old.get('session_sets').create((r:any)=>Object.assign(r._raw,{id:'kept-set',session_id:'kept',routine_exercise_id:'entry',exercise_id:'exercise',set_type:'working',reps:8,weight_kg:40,position:0,created_at:15}));
 });
 await close(old);
 const current=open(databaseSchema,true);
 try {
  expect(await readWorkoutDiary(current,'kept')).toEqual({diary:null,selfiePath:null,ready:false});
  const set=await current.get<SessionSet>('session_sets').find('kept-set');
  expect({reps:set.reps,weight:set.weightKg}).toEqual({reps:8,weight:40});
  await saveWorkoutDiary(current,'kept','Survives migration');
  await finishWorkoutDiary(current,'kept','workout-selfies/kept.jpg');
 } finally { await close(current); }
 const reopened=open(databaseSchema,true);
 try {
  expect(await readWorkoutDiary(reopened,'kept')).toEqual({diary:'Survives migration',selfiePath:'workout-selfies/kept.jpg',ready:true});
 } finally {await close(reopened);}
});
