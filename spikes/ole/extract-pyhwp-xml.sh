#!/bin/sh
# hwp5proc xml -> text (tables included). out/hwp-pyhwp-xml/
cd "$(dirname "$0")"; mkdir -p out/hwp-pyhwp-xml out/tmp
for f in samples/*/*.hwp; do n=$(basename "$f" .hwp); s=$(date +%s%N)
  if timeout 600 .venv/bin/python -I .venv/bin/hwp5proc xml "$f" > out/tmp/$n.xml 2> out/hwp-pyhwp-xml/$n.err && .venv/bin/python -I pyhwp-xml2txt.py out/tmp/$n.xml out/hwp-pyhwp-xml/$n.txt; then echo pyhwp-xml $n ok $(wc -m < out/hwp-pyhwp-xml/$n.txt) chars $(( ($(date +%s%N)-s)/1000000 ))ms; else echo pyhwp-xml $n FAIL $(head -c 100 out/hwp-pyhwp-xml/$n.err | tr '\n' ' '); fi; rm -f out/tmp/$n.xml; done
