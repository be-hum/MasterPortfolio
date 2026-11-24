# usage: python3 -I pdf2txt.py in.pdf out.txt  -- full PDF text (pypdf), used as independent reference for gov samples
import sys
from pypdf import PdfReader
r = PdfReader(sys.argv[1])
open(sys.argv[2], 'w').write('\n'.join((p.extract_text() or '') for p in r.pages))
