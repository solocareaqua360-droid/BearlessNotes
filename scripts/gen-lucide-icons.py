# Regenerates src/components/icons/lucideIcons.ts from lucide-static.
#   cd <scratch> && npm pack lucide-static && tar xzf lucide-static-*.tgz
#   python3 scripts/gen-lucide-icons.py <scratch>/package
# The mapping from Ionicons names lives in scripts/lucide-map.py.
import json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
lm = __import__('lucide-map')
pkg = sys.argv[1]
n = json.load(open(os.path.join(pkg, 'icon-nodes.json')))
lic = open(os.path.join(pkg, 'LICENSE')).read().strip()
used = sorted(set(lm.M.values()) | set(getattr(lm, 'EXTRA', [])))
missing = [v for v in used if v not in n]
if missing:
    sys.exit('not in lucide: ' + ', '.join(missing))
def fmt(attrs):
    parts = []
    for k, v in attrs.items():
        if k == 'key':
            continue
        try:
            float(v); parts.append(f"{k}:{v}")
        except ValueError:
            parts.append(f"{k}:{json.dumps(v)}")
    return '{' + ','.join(parts) + '}'
out = ["// GENERATED from lucide-static's icon-nodes.json - only the icons this app\n// uses (see FROM_IONICONS). Regenerate rather than hand-edit.\n//\n// Lucide - https://lucide.dev\n",
       "/*\n" + lic + "\n*/\n",
       "export type IconElement = ['path' | 'circle' | 'rect' | 'line' | 'polygon' | 'polyline' | 'ellipse', Record<string, string | number>];\n",
       "export const LUCIDE: Record<string, IconElement[]> = {"]
for u in used:
    out.append(f"  {json.dumps(u)}: [" + ','.join(f"['{t}',{fmt(a)}]" for t, a in n[u]) + "],")
out.append("};\n")
out.append("// Every Ionicons name the app draws (with or without '-outline'), and the\n// Lucide icon that now stands for it.")
out.append("export const FROM_IONICONS: Record<string, string> = {")
out += [f"  {json.dumps(k)}: {json.dumps(lm.M[k])}," for k in sorted(lm.M)]
out.append("};\n")
out.append("// The few filled Ionicons that mean a STATE (picked, starred, on) keep a\n// solid form: 'all' fills every shape, 'badge' fills the container and\n// draws its mark in white, 'dot' fills only the inner dot.")
out.append("export const SOLID_IONICONS: Record<string, 'all' | 'badge' | 'dot'> = {")
out += [f"  {json.dumps(k)}: {json.dumps(lm.SOLID[k])}," for k in sorted(lm.SOLID)]
out.append("};\n")
open(os.path.join(here, '..', 'src/components/icons/lucideIcons.ts'), 'w').write('\n'.join(out))
print(len(used), 'icons')
