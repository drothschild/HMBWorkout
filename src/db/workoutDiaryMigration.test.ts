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
