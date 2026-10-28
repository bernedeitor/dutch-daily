"""Run the exact Scheduler class extracted from the supplied Python file."""
import json,sys
from datetime import datetime,timezone
from fixtures import python_scheduler as original
fixed=datetime(2026,10,15,10,30,tzinfo=timezone.utc)
original.now_utc=lambda:fixed
class Store:
 def __init__(self,state):self.document={'settings':original.default_settings(),'cards':{'word0':state}}
 def track(self,name):return self.document
 def save(self):pass
out=[]
for case in json.load(sys.stdin):
 s=original.Scheduler([{'word':'word0','meaning':'meaning'}],Store(case['state']),'flashcards');s.current_word='word0';s.answer(case['rating']);out.append(s.state['word0'])
json.dump(out,sys.stdout)
