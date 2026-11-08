"""Prepare reviewed event payloads from the nine organizer-supplied PDFs.

Outputs remain private. This does not write to Supabase or change source PDFs.
"""
from pathlib import Path
import csv
import hashlib
import io
import json
import re
import pymupdf

ROOT = Path(__file__).resolve().parent.parent
DOWNLOADS = Path('C:/Users/rayan/Downloads')
OUT = ROOT / '.private-backups/revised-event'
OUT.mkdir(parents=True, exist_ok=True)
SOURCES = [
 ('TECHLIFT', 1, 'TECHLIFT_Stage_1_Technical_Quiz.pdf', 20),
 ('TECHLIFT', 2, 'TECHLIFT_Stage_2_Coding_Challenge.pdf', 40),
 ('TECHLIFT', 3, 'TECHLIFT_Stage_3_Tech_Mission.pdf', 60),
 ('DATAQUEST', 1, 'DATAQUEST_Technical_Quiz_PaperA.pdf', 15),
 ('DATAQUEST', 2, 'DATAQUEST_Stage_2_Data_Challenge_25min.pdf', 25),
 ('DATAQUEST', 3, 'DATAQUEST_Stage_3_Data_Detective.pdf', 60),
 ('AI_NEXUS', 1, 'AINEXUS_Stage_1_AI_ML_Quiz.pdf', 20),
 ('AI_NEXUS', 2, 'AINEXUS_Stage_2_Coding_Challenge_25min.pdf', 25),
 ('AI_NEXUS', 3, 'AINEXUS_Stage_3_Innovation_Challenge_5_Problems.pdf', 60),
]

def tidy(text):
 text = re.sub(r'^.*TECHLIFT 2026.*(?:STAGE 1 TECHNICAL QUIZ|Stage 1.*Page \d+).*$', '', text, flags=re.M)
 text = re.sub(r'^\s*_{5,}\s*$', '', text, flags=re.M)
 text = re.sub(r'[ \t]+\n', '\n', text)
 return re.sub(r'\n{3,}', '\n\n', text).strip()

def between(text, start, end=None):
 match = re.search(start, text, re.M)
 if not match:
  raise ValueError(f'Missing section boundary: {start}')
 value = text[match.start():]
 if end:
  stop = re.search(end, value[match.end()-match.start():], re.M)
  if not stop:
   raise ValueError(f'Missing closing boundary: {end}')
  value = value[:match.end()-match.start()+stop.start()]
 return tidy(value)

def question(position, text, marks, kind='activity', **extra):
 return dict(position=position, text=tidy(text), type=kind, marks=marks, options=[], **extra)

def quiz_questions(participant, organizer, competition):
 if competition != 'TECHLIFT':
  participant = participant[re.search(r'SECTION 1:', participant).end():]
 else:
  participant = participant[re.search(r'Q1\.', participant).start():]
 participant = tidy(participant)
 participant = re.sub(r'^\s*PART [AB]:.*$', '', participant, flags=re.M)
 key_section = re.split(r'PORTAL CONFIGURATION|Portal configuration|DETAILED EXPLANATIONS|ANSWER RATIONALES', organizer)[0]
 keys = {}
 for match in re.finditer(r'(?<![A-Za-z0-9])Q?(\d{1,2})\s*(?:\(T/F\))?\s+(True|False|[A-D])\b', key_section):
  number, answer = int(match[1]), match[2]
  if number in keys and keys[number].lower() != answer.lower():
   raise ValueError(f'Conflicting answer key for {competition} Q{number}')
  keys[number] = answer
 starts = list(re.finditer(r'(?:^|\n)\s*Q?(\d{1,2})\.\s+', participant))
 if [int(m[1]) for m in starts] != list(range(1,21)) or set(keys) != set(range(1,21)):
  raise ValueError(f'{competition}: expected 20 unique questions and answer keys')
 result = []
 for i, match in enumerate(starts):
  block = participant[match.end():starts[i+1].start() if i+1 < len(starts) else len(participant)].strip()
  if competition == 'DATAQUEST' and i >= 15:
   prompt = re.sub(r'\[\s*True\s*/\s*False\s*\]', '', block).strip()
   options = [{'label':'True','text':'True'},{'label':'False','text':'False'}]
   kind = 'true_false'
  else:
   matches = list(re.finditer(r'(?<!\S)([A-D])\.\s+', block))
   if [m[1] for m in matches] != list('ABCD'):
    raise ValueError(f'{competition} Q{i+1}: expected exactly four labeled choices')
   prompt = block[:matches[0].start()].strip()
   options = [{'label':m[1],'text':tidy(block[m.end():matches[j+1].start() if j+1<len(matches) else len(block)])} for j,m in enumerate(matches)]
   kind = 'mcq'
  result.append(dict(position=i+1,text=prompt,type=kind,options=options,correct_answer=keys[i+1],marks=5 if competition=='AI_NEXUS' else 1))
 return result

stages = []
for competition, number, filename, duration in SOURCES:
 source = DOWNLOADS / filename
 sha = hashlib.sha256(source.read_bytes()).hexdigest()
 with pymupdf.open(source) as doc:
  text = '\n'.join(page.get_text(sort=True) for page in doc)
 marker = r'ORGANIZER-ONLY ANSWER KEY' if competition=='TECHLIFT' and number==1 else r'SECTION 2:'
 boundary = re.search(marker,text)
 if not boundary:
  raise ValueError(f'{filename}: organizer boundary missing')
 participant, organizer = tidy(text[:boundary.start()]), tidy(text[boundary.start():])
 stage_name = f'Stage {number}'
 label = {'TECHLIFT':'TechLift','DATAQUEST':'DataQuest','AI_NEXUS':'AI Nexus'}[competition]
 title = f'{label} — {stage_name} — ' + (['Technical Quiz','Coding Challenge','Tech Mission'][number-1] if competition=='TECHLIFT' else ['Technical Quiz','Data Challenge','Data Detective'][number-1] if competition=='DATAQUEST' else ['AI/ML Quiz','Advanced Coding Challenge','Innovation Challenge'][number-1])
 slug = re.sub(r'[^a-z0-9]+','-',source.stem.lower()).strip('-')
 item = dict(competition_code=competition,year_group={'TECHLIFT':1,'DATAQUEST':2,'AI_NEXUS':3}[competition],stage_name=stage_name,title=title,duration_minutes=duration,source_file=str(source),source_sha256=sha,source_path=f'uploads/{competition}/{sha[:12]}-{slug}.pdf')
 payload = dict(title=title,competition_code=competition,stage_name=stage_name,duration_minutes=duration,answer_key_verified=True,source_sha256=sha,organizer_reference=organizer)
 if number == 1:
  payload['questions'] = quiz_questions(participant,organizer,competition)
  payload['instructions'] = f'{label} • Year {item["year_group"]}\nAnswer all 20 questions in {duration} minutes. Select one answer per question. No negative marking. Your answers autosave; submit before the deadline.'
  if competition=='DATAQUEST':
   payload['instructions'] += '\nQuestions 1–15 are multiple choice; questions 16–20 are True/False. Equal correctness scores are resolved using elapsed submission time.'
   payload['tie_breaker'] = 'elapsed_time'
   payload['organizer_notes'] = 'The source mentions an 80/20 correctness/speed weight but gives no speed-score formula. Raw correctness is scored; elapsed submission time is used for the explicitly specified tie-breaker.'
 elif number == 2:
  public = participant[re.search(r'SECTION 1:',participant).end():]
  starts=list(re.finditer(r'^(?:QUESTION|PROBLEM)\s+([12])\s*[-:]',public,re.M))
  if len(starts)!=2:
   raise ValueError(f'{filename}: expected two complete coding problems')
  payload['questions']=[question(i+1,public[m.start():starts[i+1].start() if i+1<len(starts) else len(public)],40 if i==0 else 60,'code') for i,m in enumerate(starts)]
  payload['instructions']=f'{label} • Year {item["year_group"]}\nUse Python 3. Complete both problems in {duration} minutes. Problem 1 carries 40 marks; Problem 2 carries 60 marks. Include complete source code and preserve the required input/output format. Code is submitted to the judges for review.'
  if competition!='TECHLIFT':payload['instructions']+='\nSuggested allocation: 10 minutes for Problem 1 and 15 minutes for Problem 2.'
 elif competition=='TECHLIFT':
  public=participant[re.search(r'SECTION 1:',participant).end():]
  payload['instructions']='TechLift • Year 1\nComplete all activities in 60 minutes: output prediction (20), debugging (30), tech puzzles (25), and a campus-navigation pitch (25). The pitch is two minutes. Written/code responses and the pitch are reviewed by judges.'
  payload['questions']=[
   question(1,'Predict the exact terminal output.\n\na = 15\nb = 4\nprint(a // b)\nprint(a % b)',10,'subjective'),
   question(2,'Predict the exact terminal output.\n\nfruits = ["apple", "banana", "cherry", "mango"]\nprint(fruits[1])\nprint(fruits[-2])',10,'subjective'),
   question(3,'Debug this program intended to calculate the average score of three subjects. Identify and explain the errors (15 marks), then provide corrected code (15 marks).\n\nscore1 = input()\nscore2 = input()\nscore3 = input()\ntotal = score1 + score2 + score3\naverage = total / 3\n\nif average >= 50\n    print("Pass")\nelse:\n    print("Fail")',30,'code'),
   question(4,between(public,r'^Puzzle 1:',r'^Puzzle 2:'),10,'subjective'),
   question(5,between(public,r'^Puzzle 2:',r'^STAGE 4:'),15,'subjective'),
   question(6,between(public,r'^STAGE 4:'),25,'activity')]
 elif competition=='DATAQUEST':
  public=participant[re.search(r'SECTION 1:',participant).end():]
  data=[]
  for m in re.finditer(r'^\s*(2026-\d{2}-\d{2})\s+(Textbooks|Stationery|Fiction)\s+(.+?)\s+(\d+)\s+(\d+)\s+(\d\.\d)\s*$',public,re.M):
   data.append([m[1],m[2],re.sub(r'\s+',' ',m[3]),int(m[4]),int(m[5]),float(m[6])])
  if len(data)!=12:raise ValueError('Data Detective: expected all 12 dataset rows')
  stream=io.StringIO();writer=csv.writer(stream,lineterminator='\n');writer.writerow(['Date','Category','Item Name','Units Sold','Unit Price','Customer Rating']);writer.writerows(data)
  payload['dataset_csv']=stream.getvalue();payload['dataset_filename']='bookstore_sales.csv'
  scenario=between(public,r'^REAL-WORLD SCENARIO',r'^DATASET:')
  payload['instructions']='DataQuest • Year 2\n60 minutes for analysis and preparation. Use Python (Pandas/Matplotlib), Excel, Google Sheets, or equivalent. Download the complete 12-row dataset below. After preparation, deliver a 3-minute presentation followed by 2 minutes of Q&A.\n\n'+scenario
  starts=list(re.finditer(r'^Task ([1-5]):',public,re.M))
  if len(starts)!=5:raise ValueError('Data Detective: expected all five tasks')
  payload['questions']=[question(i+1,public[m.start():starts[i+1].start() if i+1<len(starts) else len(public)],[15,25,20,20,20][i]) for i,m in enumerate(starts)]
  revenue=sum(row[3]*row[4] for row in data)
  categories={key:sum(row[3]*row[4] for row in data if row[1]==key) for key in ['Textbooks','Stationery','Fiction']}
  if revenue!=75850 or categories!={'Textbooks':30600,'Stationery':21000,'Fiction':24250}:raise ValueError('Dataset verification failed')
  payload['organizer_notes']='SOURCE ANSWER-GUIDE CORRECTION: The supplied 12-row dataset totals ₹75,850, not ₹66,400. Fiction revenue is ₹24,250, not ₹14,800. Textbooks ₹30,600; Stationery ₹21,000. Highest revenue: Textbooks. Highest item units: Notebook (A4), 95. Mean rating: 4.39. Use the dataset-derived figures when judging; the original PDF is retained unchanged.'
  payload['verified_metrics']={'total_revenue':revenue,'revenue_by_category':categories,'highest_units_item':'Notebook (A4)','highest_units':95,'average_rating':round(sum(row[5] for row in data)/len(data),2)}
 else:
  public=participant[re.search(r'SECTION 1:',participant).end():]
  public=re.sub(r'^\s*PBM PROBLEM STATEMENTS \(5 SELECT MODULES\)\s*','',public)
  modules=list(re.finditer(r'^PBM ([1-5]):',public,re.M))
  if len(modules)!=5:raise ValueError('AI Nexus: expected all five PBM options')
  payload['instructions']='AI Nexus • Year 3\nChoose ONE of the five PBM options below. You have 60 minutes for design and pitch preparation, followed by a 3-minute pitch and 2-minute Q&A. For the selected module address all four guiding questions and the five common elements: real-world problem identification, proposed web solution, key features, technology/tools, and expected benefits/impact.\n\n'+public
  payload['questions']=[question(1,'State your selected PBM number and title. Submit the solution for that module, covering:\n1. Problem, target users, and pain points.\n2. Proposed website architecture, workflow, and user journey.\n3. Key features, data inputs, real-time updates, and edge cases.\n4. Frontend/backend/database/API or algorithm choices and justification.\n5. Expected benefits and impact.\n\nAnswer the four guiding questions for your chosen module. Include your prototype/demo or evidence link if available and your 3-minute pitch outline. Do not attempt all five modules.',100)]
 if sum(q['marks'] for q in payload['questions']) != (20 if competition in ('TECHLIFT','DATAQUEST') and number==1 else 100):raise ValueError(f'{filename}: score total mismatch')
 for q in payload['questions']:
  if re.search(r'ORGANIZER|CONFIDENTIAL|Expected:\s*₹|Python Reference Solution|Hidden Test Cases',q['text'],re.I):raise ValueError(f'{filename}: organizer content leaked into participant prompt')
 item['quiz_payload']=payload
 stages.append(item)
 print(f'{competition} / Year {item["year_group"]} / {stage_name}: {len(payload["questions"])} answer field(s), {duration} minutes, {sum(q["marks"] for q in payload["questions"])} marks')

(OUT/'manifest.json').write_text(json.dumps(stages,ensure_ascii=False,indent=2),encoding='utf-8')
print('Prepared private reviewed manifest; no database changes applied.')
