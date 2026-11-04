#!/bin/sh
cd "$(dirname "$0")"
URL=http://localhost:8080/frontend/
( sleep 1; (command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") ) &
if command -v node >/dev/null; then node tools/serve.mjs 8080; else python3 -m http.server 8080; fi
