"""Read supplied XLSX rosters without altering workbooks or printing tickets."""
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET
import re,json
ROOT=Path(__file__).resolve().parent.parent
NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def col(ref):
 value=0
 for c in re.match(r'[A-Z]+',ref)[0]:value=value*26+ord(c)-64
 return value-1
teams=[];seen=set()
for code,suffix in [('TECHLIFT','techlift'),('DATAQUEST','dataquest'),('AI_NEXUS','ainexus')]:
 source=Path('C:/Users/rayan/Downloads')/f'ikarus-sheet-data-science-{suffix}.xlsx'
 with ZipFile(source) as z:
  strings=[]
  if 'xl/sharedStrings.xml' in z.namelist():strings=[''.join(t.text or '' for t in si.iter('{'+NS['m']+'}t')) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]
  rows=[]
  for r in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//m:row',NS):
   cells={}
   for c in r.findall('m:c',NS):
    if c.find('m:f',NS) is not None:raise ValueError('Formula in roster input; review before import')
    v=c.find('m:v',NS)
    value=(strings[int(v.text)] if c.get('t')=='s' else v.text) if v is not None else ''.join(t.text or '' for t in c.findall('.//m:t',NS))
    cells[col(c.get('r'))]=(value or '').strip()
   row=[cells.get(i,'') for i in range(max(cells,default=-1)+1)]
   if any(row):rows.append(row)
  hi=next(i for i,row in enumerate(rows) if 'team name' in [x.lower() for x in row] and 'ticket id' in [x.lower() for x in row])
  headers=[x.lower() for x in rows[hi]];ti=headers.index('team name');ri=headers.index('ticket id');li=headers.index('lead name') if 'lead name' in headers else None
  count=0
  for row in rows[hi+1:]:
   name=row[ti] if ti<len(row) else '';ticket=row[ri] if ri<len(row) else ''
   if not name and not ticket:continue
   if not name or not ticket:raise ValueError(f'{code}: incomplete team record')
   if len(ticket)<4 or len(ticket)>128:raise ValueError(f'{code}: invalid ticket length')
   key=(code,ticket.casefold())
   if key in seen:raise ValueError(f'{code}: duplicate ticket in source workbook')
   seen.add(key);lead=row[li] if li is not None and li<len(row) else ''
   teams.append(dict(competition_code=code,team_name=name,registration_number=ticket,members=[lead] if lead else []));count+=1
  print(f'{code}: {count} teams validated')
out=ROOT/'.private-backups/revised-event';out.mkdir(exist_ok=True)
(out/'teams.json').write_text(json.dumps(teams,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'{len(teams)} team records prepared privately; no database changes applied.')
