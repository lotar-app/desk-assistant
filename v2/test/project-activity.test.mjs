import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ProjectActivityDomainError,
  ProjectActivityRepository,
  normalizeActivityAlias
} from "../src/mcp/project-activity-repository.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("ProjectActivity: creazione esplicita, lookup e modalità COMPACT/FULL/KEYS", async () => {
  const db = localDb();
  seedProject(db, "P1", "Project One");
  const repository = new ProjectActivityRepository(db);
  const created = await repository.updateProjectActivity(updateInput({
    projectId:"P1",name:"Black Winter",kind:"CAMPAIGN",createIfMissing:true,
    expectedSnapshotVersion:0,idempotencyKey:"activity-create",
    aliases:{add:["BW"],remove:[]},
    patch:{set:{focus:"Launch",nextAction:"Approve copy"},clear:[]},
    items:[
      {op:"UPSERT",key:"commercial.mechanism",type:"DECISION",value:{discount:20}},
      {op:"UPSERT",key:"email.first.subject",type:"CONTENT",value:"Winter starts"},
      {op:"UPSERT",key:"email.provider",type:"TECHNICAL_CONTEXT",value:"PostPickr"}
    ]
  }));
  assert.equal(created.created,true);
  assert.equal(created.snapshotVersion,1);
  assert.equal(created.timelineEvent.type,"PROJECT_ACTIVITY_CREATED");
  assert.equal(count(db,"timeline_events"),1);
  assert.equal(count(db,"project_activity_item_revisions"),3);
  assert.throws(()=>db.raw.exec("UPDATE project_activity_item_revisions SET reason='tamper'"),/PROJECT_ACTIVITY_REVISION_APPEND_ONLY/);
  assert.throws(()=>db.raw.exec("DELETE FROM project_activity_item_revisions"),/PROJECT_ACTIVITY_REVISION_APPEND_ONLY/);

  const byId = await repository.getProjectActivity({activityId:created.activityId,mode:"FULL"});
  assert.equal(byId.activity.focus,"Launch");
  assert.deepEqual(byId.items["commercial.mechanism"].value,{discount:20});
  const byName = await repository.getProjectActivity({projectId:"P1",name:"Ｂｌａｃｋ   Winter",mode:"COMPACT"});
  assert.equal(byName.activityId,created.activityId);
  assert.equal(byName.contentsApproved["email.first.subject"].value,"Winter starts");
  const byAlias = await repository.getProjectActivity({projectId:"P1",name:"bw",mode:"KEYS",keys:["email.provider","missing"]});
  assert.equal(byAlias.items["email.provider"].value,"PostPickr");
  assert.equal(byAlias.items.missing,null);
  const global = await repository.getProjectActivity({name:"BW",global:true,mode:"FULL"});
  assert.equal(global.projectId,"P1");
  db.close();
});

test("ProjectActivity: alias globale ambiguo e attività assente producono errori strutturati", async () => {
  const db=localDb();seedProject(db,"P1","One");seedProject(db,"P2","Two");
  const repository=new ProjectActivityRepository(db);
  await repository.updateProjectActivity(updateInput({projectId:"P1",name:"First",kind:"CAMPAIGN",createIfMissing:true,expectedSnapshotVersion:0,idempotencyKey:"a1",aliases:{add:["shared"],remove:[]}}));
  await repository.updateProjectActivity(updateInput({projectId:"P2",name:"Second",kind:"CAMPAIGN",createIfMissing:true,expectedSnapshotVersion:0,idempotencyKey:"a2",aliases:{add:["shared"],remove:[]}}));
  await rejectsCode(()=>repository.getProjectActivity({name:"shared",global:true,mode:"COMPACT"}),"AMBIGUOUS_ACTIVITY");
  await rejectsCode(()=>repository.getProjectActivity({projectId:"P1",name:"absent",mode:"FULL"}),"ACTIVITY_NOT_FOUND");
  db.close();
});

test("ProjectActivity: UPSERT sostituisce stable key, DELETE revisiona, NO-OP non incrementa", async () => {
  const db=localDb();seedProject(db,"P","Project");const repository=new ProjectActivityRepository(db);
  const created=await repository.updateProjectActivity(updateInput({projectId:"P",name:"Campaign",kind:"CAMPAIGN",createIfMissing:true,expectedSnapshotVersion:0,idempotencyKey:"create",items:[{op:"UPSERT",key:"email.subject",type:"CONTENT",value:"A"}],aliases:{add:["old"],remove:[]}}));
  const changed=await repository.updateProjectActivity(updateInput({projectId:"P",activityId:created.activityId,expectedSnapshotVersion:1,idempotencyKey:"replace",items:[{op:"UPSERT",key:"email.subject",type:"CONTENT",value:"B"}],aliases:{add:["new"],remove:["old"]}}));
  assert.equal(changed.snapshotVersion,2);assert.deepEqual(changed.changedKeys.includes("email.subject"),true);
  const full=await repository.getProjectActivity({activityId:created.activityId,mode:"FULL"});
  assert.equal(full.items["email.subject"].value,"B");
  assert.equal(scalar(db,"SELECT item_revision FROM project_activity_items WHERE item_key='email.subject'"),2);
  const deleted=await repository.updateProjectActivity(updateInput({projectId:"P",activityId:created.activityId,expectedSnapshotVersion:2,idempotencyKey:"delete",items:[{op:"DELETE",key:"email.subject",reason:"Explicit revocation"}]}));
  assert.equal(deleted.snapshotVersion,3);assert.equal(count(db,"project_activity_items"),0);assert.equal(count(db,"project_activity_item_revisions"),3);
  const noOp=await repository.updateProjectActivity(updateInput({projectId:"P",activityId:created.activityId,expectedSnapshotVersion:3,idempotencyKey:"noop",items:[{op:"DELETE",key:"missing",reason:"Nothing stored"}]}));
  assert.equal(noOp.noOp,true);assert.equal(noOp.snapshotVersion,3);assert.equal(noOp.timelineEvent,null);assert.equal(count(db,"timeline_events"),3);
  db.close();
});

test("ProjectActivity: replay, conflitto idempotente e conflitto versione", async () => {
  const db=localDb();seedProject(db,"P","Project");const repository=new ProjectActivityRepository(db);
  const input=updateInput({projectId:"P",name:"Campaign",kind:"CAMPAIGN",createIfMissing:true,expectedSnapshotVersion:0,idempotencyKey:"same"});
  const first=await repository.updateProjectActivity(input);const replayed=await repository.updateProjectActivity(input);
  assert.equal(replayed.replayed,true);assert.equal(replayed.activityId,first.activityId);assert.equal(count(db,"timeline_events"),1);
  await rejectsCode(()=>repository.updateProjectActivity({...input,name:"Different"}),"IDEMPOTENCY_CONFLICT");
  await rejectsCode(()=>repository.updateProjectActivity(updateInput({projectId:"P",activityId:first.activityId,expectedSnapshotVersion:0,idempotencyKey:"stale"})),"SNAPSHOT_VERSION_CONFLICT");
  db.close();
});

test("ProjectActivity: lifecycle Project e creazione implicita sono rifiutati", async () => {
  const db=localDb();seedProject(db,"ARCH","Archived","ARCHIVED");const repository=new ProjectActivityRepository(db);
  await rejectsCode(()=>repository.updateProjectActivity(updateInput({projectId:"MISSING",name:"X",kind:"CAMPAIGN",createIfMissing:true,expectedSnapshotVersion:0,idempotencyKey:"missing"})),"PROJECT_NOT_FOUND");
  await rejectsCode(()=>repository.updateProjectActivity(updateInput({projectId:"ARCH",name:"X",kind:"CAMPAIGN",createIfMissing:true,expectedSnapshotVersion:0,idempotencyKey:"archived"})),"PROJECT_ARCHIVED");
  seedProject(db,"P","Project");
  await rejectsCode(()=>repository.updateProjectActivity(updateInput({projectId:"P",name:"X",kind:"CAMPAIGN",createIfMissing:false,expectedSnapshotVersion:0,idempotencyKey:"implicit"})),"ACTIVITY_NOT_FOUND");
  assert.equal(count(db,"project_activities"),0);assert.equal(count(db,"mcp_idempotency"),0);db.close();
});

test("ProjectActivity: batch fallito rollbacka snapshot, alias, item, revisioni, ricevuta e Timeline", async () => {
  const db=localDb();seedProject(db,"P","Project");const repository=new ProjectActivityRepository(db);
  db.failNextBatchAt(4);
  await rejectsCode(()=>repository.updateProjectActivity(updateInput({projectId:"P",name:"Campaign",kind:"CAMPAIGN",createIfMissing:true,expectedSnapshotVersion:0,idempotencyKey:"rollback",aliases:{add:["alias"],remove:[]},items:[{op:"UPSERT",key:"approved",type:"DECISION",value:true}]})),"D1_OPERATION_FAILED");
  for(const table of ["project_activities","project_activity_aliases","project_activity_items","project_activity_item_revisions","mcp_idempotency","timeline_events"])assert.equal(count(db,table),0,table);
  db.close();
});

test("normalizzazione alias conserva il contratto V1 approvato",()=>{
  assert.equal(normalizeActivityAlias(" Ｂｌａｃｋ   WINTER "),"black winter");
});

function updateInput(overrides={}) { return {projectId:"P",activityId:undefined,name:undefined,kind:undefined,createIfMissing:false,expectedSnapshotVersion:1,idempotencyKey:"key",patch:{set:{},clear:[]},items:[],aliases:{add:[],remove:[]},source:"API",timelineEvent:{description:"Approved ProjectActivity update."},...overrides}; }
async function rejectsCode(fn,code){await assert.rejects(fn,error=>error instanceof ProjectActivityDomainError&&error.code===code);}
function seedProject(db,id,name,lifecycle="ACTIVE"){const now="2026-10-26T08:00:00.000Z";db.raw.prepare("INSERT INTO containers (container_id,parent_id,name,status,focus,owner,next_action,lifecycle_state,version,created_at,updated_at,archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(id,null,name,"OPEN",null,null,null,lifecycle,1,now,now,lifecycle==="ARCHIVED"?now:null);}
function count(db,table){return Number(db.raw.prepare(`SELECT count(*) value FROM ${table}`).get().value);}
function scalar(db,sql){return db.raw.prepare(sql).get()[Object.keys(db.raw.prepare(sql).get())[0]];}

function localDb(){
  const raw=new DatabaseSync(":memory:");raw.exec("PRAGMA foreign_keys=ON");
  for(const file of ["0001_foundation.sql","0002_mcp_capability_test.sql","0003_container_create_idempotency.sql","0004_hierarchy_schema_preparation.sql","0005_timeline_task_completion.sql","0006_project_activity.sql"])raw.exec(readFileSync(join(root,"migrations",file),"utf8"));
  let failAt=null;
  const database={raw,close(){raw.close();},failNextBatchAt(index){failAt=index;},prepare(sql){let values=[];return{bind(...args){values=args;return this;},first(){return raw.prepare(sql).get(...values)??null;},all(){return{results:raw.prepare(sql).all(...values)};},_sql:sql,_values(){return values;}};},async batch(statements){raw.exec("BEGIN IMMEDIATE");try{const results=[];for(let index=0;index<statements.length;index++){if(failAt===index){failAt=null;throw new Error("synthetic batch failure");}const statement=raw.prepare(statements[index]._sql);const values=statements[index]._values();if(/^\s*SELECT/i.test(statements[index]._sql))results.push({success:true,results:statement.all(...values)});else{statement.run(...values);results.push({success:true,results:[]});}}raw.exec("COMMIT");return results;}catch(error){raw.exec("ROLLBACK");throw error;}}};
  return database;
}
