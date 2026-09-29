"""Build the pinned offline catalog from a downloaded upstream ZIP; never execute it."""
import json, pathlib, re, sys, zipfile
root = pathlib.Path(__file__).resolve().parents[1]
archive, revision = sys.argv[1:3]
labels = dict(zip('academic design engineering finance game-development gis healthcare marketing paid-media product project-management research sales security spatial-computing specialized support testing'.split(), '学术研究 设计 工程研发 财务 游戏开发 地理信息 医疗健康 市场营销 付费投放 产品 项目管理 调研 销售 安全 空间计算 专项能力 运营支持 质量测试'.split()))
old = {r['id']:r for r in json.loads((root/'src/data/agency-catalog.json').read_text(encoding='utf-8'))}
def field(text, key):
    m=re.search(r'^'+key+r':\s*(.+)$',text,re.M)
    return m.group(1).strip().strip('"\'') if m else ''
with zipfile.ZipFile(archive) as z:
    prefix=z.namelist()[0].split('/')[0]+'/'
    divisions=json.loads(z.read(prefix+'divisions.json'))['divisions']
    roles=[]
    for name in sorted(z.namelist()):
        path=name[len(prefix):]
        if not path.endswith('.md') or path.split('/')[0] not in divisions: continue
        raw=z.read(name).decode('utf-8-sig')
        if not raw.startswith('---'): continue
        header=raw.split('---',2)[1]
        title=field(header,'name')
        if not title: continue
        id=path[:-3].split('/')[-1]
        if any(r['id']==id for r in roles): raise ValueError('Duplicate role '+id)
        prior=old.get(id,{})
        division=path.split('/')[0]
        roles.append(dict(id=id,name=prior.get('name',title),originalName=title,division=labels.get(division,divisions[division]['label']),category=division,summary=prior.get('summary',field(header,'description') or title),strengths=prior.get('strengths',[labels.get(division,division)]),instructions=raw,source=f'https://github.com/msitarzewski/agency-agents/blob/{revision}/{path}',sourcePath=path,sourceRevision=revision,color=divisions[division]['color']))
    (root/'src/data/agency-catalog.json').write_text(json.dumps(roles,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    metadata={'repo':'msitarzewski/agency-agents','revision':revision,'roleCount':len(roles),'divisions':{key:{**value,'label':labels.get(key,value['label'])} for key,value in divisions.items()}}
    (root/'src/data/agency-source.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'roles':len(roles),'divisions':len(divisions),'revision':revision}))
