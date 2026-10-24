from datetime import datetime, timedelta

NOW = datetime(2026, 10, 24, 11, 30)

CITIES = {'helsinki': ('FI', 'Helsinki'), 'espoo': ('FI', 'Espoo'),
          'tampere': ('FI', 'Tampere'), 'turku': ('FI', 'Turku'),
          'stockholm': ('SE', 'Stockholm'), 'berlin': ('DE', 'Berlin'),
          'hamburg': ('DE', 'Hamburg')}

VEHICLES = {'sedan': ['sedan'], 'suv': ['suv'], 'van': ['van']}

RATES = {('FI', 'FI'): {'sedan': 290, 'suv': 340, 'van': 420},
         ('DE', 'FI'): {'sedan': 1290, 'suv': 1420, 'van': 1690}}

HOURS = {('FI', 'FI'): 24, ('DE', 'FI'): 72}

ROSTER = [
    {'id': 'D-01', 'name': 'Mikko L.', 'base': 'Helsinki', 'country': 'FI',
     'classes': ['sedan', 'suv'], 'slots': 1},
    {'id': 'D-05', 'name': 'Pekka R.', 'base': 'Helsinki', 'country': 'FI',
     'classes': ['van'], 'slots': 1},
    {'id': 'D-04', 'name': 'Erik B.', 'base': 'Berlin', 'country': 'DE',
     'classes': ['sedan', 'suv', 'van'], 'slots': 2},
]


def parse(raw):
    toks = raw.lower().replace(',', ' ').split()
    cities = [CITIES[t] for t in toks if t in CITIES]
    vehicle = None
    for cls, words in VEHICLES.items():
        if any(w in toks for w in words):
            vehicle = cls
            break
    explicit = 'from' in toks and 'to' in toks
    conf = {
        'pickup': 1.0 if (cities and explicit) else (0.9 if cities else 0.0),
        'delivery': 1.0 if (len(cities) > 1 and explicit) else (0.9 if len(cities) > 1 else 0.0),
        'vehicle': 1.0 if vehicle else 0.0,
    }
    return {
        'pickup': cities[0] if cities else None,
        'delivery': cities[1] if len(cities) > 1 else None,
        'vehicle': vehicle, 'confidence': conf,
    }


def price(p):
    if not p['pickup'] or not p['delivery']:
        return None, 'pickup or delivery missing'
    route = (p['pickup'][0], p['delivery'][0])
    if route not in RATES:
        return None, 'no rate for ' + route[0] + ' to ' + route[1]
    if not p['vehicle']:
        return None, 'vehicle class missing'
    h = HOURS[route]
    return {'route': route[0] + ' to ' + route[1],
            'eur': RATES[route][p['vehicle']], 'hours': h,
            'by': (NOW + timedelta(hours=h)).strftime('%Y-%m-%d %H:%M')}, None


def assign(p, roster):
    if not p['pickup'] or not p['vehicle']:
        return None, 'cannot assign without pickup and vehicle class'
    best = []
    for d in roster:
        if d['slots'] <= 0 or p['vehicle'] not in d['classes']:
            continue
        score, why = 0, []
        if d['country'] == p['pickup'][0]:
            score += 2
            why.append('same country as pickup')
        if d['base'] == p['pickup'][1]:
            score += 3
            why.append('based in pickup city')
        if score:
            best.append((score, d, why))
    if not best:
        return None, 'no driver with an open slot for class ' + p['vehicle'] + ' near ' + p['pickup'][1]
    best.sort(key=lambda x: (-x[0], x[1]['id']))
    _, d, why = best[0]
    d['slots'] -= 1
    return {'id': d['id'], 'name': d['name'], 'why': ', '.join(why)}, None


def process(raw):
    log = []
    p = parse(raw)
    log.append('parsed: pickup=' + str(p['pickup']) + ' delivery=' + str(p['delivery']) + ' vehicle=' + str(p['vehicle']))
    needs = []
    pr, err = price(p)
    if pr:
        log.append('priced: ' + pr['route'] + ' EUR ' + str(pr['eur']) + ', promised by ' + pr['by'])
    else:
        needs.append(err)
    drv = None
    if pr:
        drv, derr = assign(p, ROSTER)
        if drv:
            log.append('assigned: ' + drv['id'] + ' ' + drv['name'] + ' (' + drv['why'] + ')')
        else:
            needs.append(derr)
    for k, v in p['confidence'].items():
        if v < 0.7:
            needs.append('low confidence on ' + k)
    if needs:
        log.append('ESCALATED: ' + '; '.join(needs))
    return log


ORDERS = [
    'Pickup from Helsinki to Tampere, sedan',
    'Need a van moved Helsinki to Turku today',
    'Import from Berlin to Helsinki, SUV',
    'Espoo to Helsinki, van',
]

for o in ORDERS:
    print('ORDER  ' + o)
    for line in process(o):
        print('  ' + line)
    print()
