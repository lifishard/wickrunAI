'use strict';
const crypto=require('node:crypto');
const id='latest-revision-v1';
const input='id,revision,status,amount_cents\nr1,1,posted,1000\nr2,1,posted,250\nr3,1,posted,500\nr1,2,void,1000\nr3,2,posted,600\nr4,1,posted,400\nr5,1,void,300\n';
const goal='读取 input.csv，统计 posted 记录，写 report.json。更正：每个 id 只能采用 revision 最大的一条；然后才筛选 status=posted。最新记录是 void 时不得回退到旧 posted 记录。不要改动 input.csv，只交付 report.json。';
const acceptance='report.json 是有效 JSON，只有 included_ids 与 total_cents 两个字段。included_ids 按字典序排列，total_cents 是所纳入最新 posted 记录的 amount_cents 整数总和。input.csv 字节保持不变。';
const digest=body=>crypto.createHash('sha256').update(body).digest('hex');
function validate(output,inputAfter){
 const failures=[];let value;
 try{value=JSON.parse(output);}catch{failures.push('invalid_json');}
 if(value){
  if(Object.keys(value).sort().join(',')!=='included_ids,total_cents')failures.push('fields');
  if(JSON.stringify(value.included_ids)!==JSON.stringify(['r2','r3','r4']))failures.push('included_ids');
  if(value.total_cents!==1250)failures.push('total_cents');
 }else if(!failures.length)failures.push('not_an_object');
 if(digest(inputAfter)!==digest(input))failures.push('input_modified');
 return {passed:failures.length===0,failures};
}
module.exports={id,input,goal,acceptance,digest,validate};
