# usage: python3 -I pyhwp-xml2txt.py in.xml out.txt  -- text of <Text> nodes in document order (incl. tables, footnotes, headers)
import sys
from lxml import etree
out = []
for ev, el in etree.iterparse(sys.argv[1], events=('end',), huge_tree=True):
    if el.tag == 'Text' and el.text: out.append(el.text)
    elif el.tag == 'ControlChar' and el.get('code') in ('10', '13'): out.append('\n')
    if el.tag in ('Text', 'ControlChar'): el.clear()
open(sys.argv[2], 'w').write(''.join(out))
