"""Minimal AC3D (.ac) parser: returns materials and a flat list of poly objects with world-space verts."""
import re

def parse(path):
    lines=open(path,encoding='latin-1').read().splitlines()
    st={'i':0}
    def nxt():
        l=lines[st['i']];st['i']+=1;return l
    assert nxt().startswith('AC3D')
    mats=[];out=[]
    def read_obj(pxf,path):
        hdr=nxt().split();kind=hdr[1]
        o={'kind':kind,'name':'','texture':None,'texrep':(1,1),'texoff':(0,0),'loc':(0,0,0),'rot':None,'verts':[],'surfs':[],'crease':None}
        while True:
            l=nxt();t=l.split()
            if not t: continue
            k=t[0]
            if k=='name': o['name']=l.split(None,1)[1].strip().strip('"')
            elif k=='data':
                n=int(t[1]);d=''
                while len(d)<n: d+=nxt()+'\n'
            elif k=='texture': o['texture']=l.split(None,1)[1].strip().strip('"')
            elif k=='texrep': o['texrep']=(float(t[1]),float(t[2]))
            elif k=='texoff': o['texoff']=(float(t[1]),float(t[2]))
            elif k=='crease': o['crease']=float(t[1])
            elif k=='loc': o['loc']=tuple(map(float,t[1:4]))
            elif k=='rot': o['rot']=tuple(map(float,t[1:10]))
            elif k=='numvert':
                for _ in range(int(t[1])): o['verts'].append(tuple(map(float,nxt().split()[:3])))
            elif k=='numsurf':
                for _ in range(int(t[1])):
                    s={'flags':0,'mat':0,'refs':[]}
                    while True:
                        u=nxt().split()
                        if u[0]=='SURF': s['flags']=int(u[1],16)
                        elif u[0]=='mat': s['mat']=int(u[1])
                        elif u[0]=='refs':
                            for _ in range(int(u[1])):
                                v=nxt().split();s['refs'].append((int(v[0]),float(v[1]),float(v[2])))
                            break
                    o['surfs'].append(s)
            elif k=='kids':
                R=o['rot'];L=o['loc']
                def xf(v,R=R,L=L,pxf=pxf):
                    x,y,z=v
                    if R: x,y,z=(R[0]*x+R[3]*y+R[6]*z,R[1]*x+R[4]*y+R[7]*z,R[2]*x+R[5]*y+R[8]*z)
                    return pxf((x+L[0],y+L[1],z+L[2]))
                o['world']=[xf(v) for v in o['verts']]
                o['path']=path+[o['name']]
                if kind=='poly': out.append(o)
                for _ in range(int(t[1])): read_obj(xf,o['path'])
                return
    while st['i']<len(lines):
        l=lines[st['i']]
        if l.startswith('MATERIAL'):
            m=re.match(r'MATERIAL "([^"]*)" rgb (\S+) (\S+) (\S+)\s+amb (\S+) (\S+) (\S+)\s+emis (\S+) (\S+) (\S+)\s+spec (\S+) (\S+) (\S+)\s+shi (\S+)\s+trans (\S+)',l)
            g=m.groups();mats.append({'name':g[0],'rgb':tuple(map(float,g[1:4])),'emis':tuple(map(float,g[7:10])),'spec':tuple(map(float,g[10:13])),'shi':float(g[13]),'trans':float(g[14])})
            st['i']+=1
        elif l.startswith('OBJECT'):
            read_obj(lambda v:v,[])
        else: st['i']+=1
    return mats,out
