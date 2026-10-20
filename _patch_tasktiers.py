import re
p = r'C:/Users/iulia/Desktop/TheLotusCross/server/server.js'
s = open(p, encoding='utf-8').read()

# 1. schema: practices can belong to a plan
anchor = '  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT \'free\'");'
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + '''
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tier_required TEXT DEFAULT 'free'");''')

# 2. seed: carry the tier through
old_seed = '''      await pool.query(
        "INSERT INTO tasks (title, description, category, xp, sort_order, min_count, requires_proof, proof_hint) VALUES ($1,$2,$3,$4,$5,$6,true,$7)",
        [p.title, p.desc, 'service', p.xp, 10 + i, p.min, p.hint]);'''
new_seed = '''      await pool.query(
        "INSERT INTO tasks (title, description, category, xp, sort_order, min_count, requires_proof, proof_hint, tier_required) VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8)",
        [p.title, p.desc, 'service', p.xp, 10 + i, p.min, p.hint, p.tier || 'free']);'''
assert s.count(old_seed) == 1
s = s.replace(old_seed, new_seed)

# 3. keep tier_required in step with the file on every boot
old_added = "  if (added) console.log('  Practices added to the ladder: ' + added);"
new_added = """  if (added) console.log('  Practices added to the ladder: ' + added);
  for (let i = 0; i < PRACTICES.length; i++) {
    const p = PRACTICES[i];
    await pool.query("UPDATE tasks SET tier_required=$1, min_count=$2 WHERE title=$3 AND requires_proof=true",
      [p.tier || 'free', p.min, p.title]);
  }"""
assert s.count(old_added) == 1
s = s.replace(old_added, new_added)

# 4. dashboard: only offer practices the person can actually do
old_q = '''    "SELECT id, title, description, category, xp, min_count, requires_proof, proof_hint FROM tasks WHERE active=true AND COALESCE(min_count,0) <= $1 ORDER BY COALESCE(min_count,0) DESC, sort_order, id LIMIT 12",
    [u.tasks_completed || 0])).rows;'''
new_q = '''    "SELECT id, title, description, category, xp, min_count, requires_proof, proof_hint, COALESCE(tier_required,'free') AS tier_required FROM tasks WHERE active=true AND COALESCE(min_count,0) <= $1 ORDER BY COALESCE(min_count,0), sort_order, id LIMIT 20",
    [u.tasks_completed || 0])).rows;
  const visibleTasks = tasks.filter(t => !t.tier_required || t.tier_required === 'free' || entitled(u, t.tier_required));'''
assert s.count(old_q) == 1
s = s.replace(old_q, new_q)

s = s.replace("ranks: RANKS, tasks: tasks, doneToday:", "ranks: RANKS, tasks: visibleTasks, doneToday:")

# 5. proof submission must respect the plan too
old_proof = """    if ((task.min_count || 0) > (u.tasks_completed || 0)) return res.status(403).json({ error: 'This practice is not yet unlocked for you' });"""
new_proof = """    if ((task.min_count || 0) > (u.tasks_completed || 0)) return res.status(403).json({ error: 'This practice is not yet unlocked for you' });
    if (task.tier_required && task.tier_required !== 'free' && !entitled(u, task.tier_required)) {
      return res.status(403).json({ error: 'This practice belongs to the ' + (task.tier_required === 'circle' ? 'Circle' : 'Supporter') + ' plan' });
    }"""
assert s.count(old_proof) == 1
s = s.replace(old_proof, new_proof)

open(p, 'w', encoding='utf-8').write(s)
print('server: tiered practices')
