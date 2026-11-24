#!/bin/sh
# usage: extract-pyhwp.sh  (runs hwp5txt on every samples/*/*.hwp -> out/hwp-pyhwp/)
cd "$(dirname "$0")"; mkdir -p out/hwp-pyhwp
for f in samples/*/*.hwp; do n=$(basename "$f" .hwp); s=$(date +%s%N)
  if timeout 300 .venv/bin/python -I .venv/bin/hwp5txt "$f" > "out/hwp-pyhwp/$n.txt" 2> "out/hwp-pyhwp/$n.err"; then echo pyhwp $n ok $(wc -m < out/hwp-pyhwp/$n.txt) chars $(( ($(date +%s%N)-s)/1000000 ))ms; else echo pyhwp $n FAIL $(head -c 100 out/hwp-pyhwp/$n.err | tr '\n' ' '); fi; done
