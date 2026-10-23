// Demo mode: fake data kept in this browser only. Follows the same rules
// as the real database so you can try every screen before setup.
window.DemoApi = {
  create(C) {
    const L = window.Logic;
    const KEY = 'tutoring-demo-v1';
    const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2));
    let mem = null;
    const load = () => { if (mem) return mem; try { mem = JSON.parse(localStorage.getItem(KEY)); } catch { mem = null; } if (!mem) mem = seed(); return mem; };
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* memory only */ } };
    const clone = x => JSON.parse(JSON.stringify(x));
    const fail = msg => { throw new Error(msg); };

    function seed() {
      const today = L.todayISO(), sy = L.schoolYear(today);
      const P = (id, username, role, first_name, last_name, phone, level, units, pay = 0) => ({
        id, username, role, first_name, last_name, phone, level_base: level, level_base_year: level ? sy : null,
        math_units: units, pay_rate: pay, notes: '', created_at: new Date().toISOString(),
      });
      const profiles = [
        P('admin', 'admin', 'admin', 'You', '(Admin)', '050-0000000', null, null, 0),
        P('t1', 'rami', 'teacher', 'Rami', 'Haddad', '052-1111111', null, null, 70),
        P('t2', 'lina', 'teacher', 'Lina', 'Saleh', '054-2222222', null, null, 80),
        P('t3', 'omar', 'pending_teacher', 'Omar', 'Khoury', '053-3333333', null, null, 0),
        P('s1', 'adam', 'student', 'Adam', 'Nassar', '050-4444444', 7, null),
        P('s2', 'maya', 'student', 'Maya', 'Levi', '050-5555555', 11, 5),
        P('s3', 'yousef', 'student', 'Yousef', 'Ali', '052-6666666', 12, 4),
        P('s4', 'noa', 'student', 'Noa', 'Cohen', '054-7777777', 4, null),
        P('s5', 'jad', 'student', 'Jad', 'Mansour', '053-8888888', 13, null),
      ];
      const prices = [
        { key: 'elementary', label: 'Grades 1–6', min_level: 1, max_level: 6, hourly_price: 90, sort: 1 },
        { key: 'middle', label: 'Grades 7–9', min_level: 7, max_level: 9, hourly_price: 110, sort: 2 },
        { key: 'high', label: 'Grades 10–12', min_level: 10, max_level: 12, hourly_price: 140, sort: 3 },
        { key: 'college', label: 'College 1st year', min_level: 13, max_level: 13, hourly_price: 160, sort: 4 },
        { key: 'graduated', label: 'Graduated', min_level: 14, max_level: 14, hourly_price: 160, sort: 5 },
      ];
      mem = { profiles, prices, lessons: [], money: {}, session: null };
      const mk = (dayOff, time, t, s, subject, dur, status, topic = '') => {
        const l = {
          id: uid(), teacher_id: t, student_id: s, subject, starts_at: L.toUTC(L.addDays(today, dayOff), time),
          duration_min: dur, status, topic, teacher_note: '', admin_note: '', created_by: 'admin',
          created_at: new Date().toISOString(), approved_at: status === 'approved' ? new Date().toISOString() : null,
        };
        snapshot(l); mem.lessons.push(l); money(l.id);
      };
      mk(-6, '16:00', 't1', 's1', 'Math', 60, 'approved', 'Fractions and percentages');
      mk(-5, '17:30', 't2', 's2', 'Math', 90, 'approved', 'Bagrut 5 units: derivatives');
      mk(-3, '18:00', 't2', 's3', 'Physics', 60, 'approved', 'Mechanics: Newton\'s laws');
      mk(-2, '16:00', 't1', 's4', 'Math', 45, 'pending', 'Multiplication table');
      mk(-1, '19:00', 't2', 's5', 'Computer Science', 90, 'pending', 'Intro to C: loops');
      mk(0, '15:00', 't1', 's1', 'Math', 60, 'scheduled', 'Equations with one unknown — bring workbook');
      mk(0, '16:30', 't1', 's4', 'Math', 45, 'scheduled', 'Long division');
      mk(0, '17:00', 't2', 's2', 'Math', 90, 'scheduled', 'Bagrut 806: integrals practice exam');
      mk(0, '19:00', 't2', 's3', 'Electronics', 60, 'scheduled', 'Ohm\'s law & circuits');
      mk(1, '16:00', 't1', 's1', 'Physics', 60, 'scheduled', 'Speed and acceleration');
      mk(2, '18:00', 't2', 's5', 'Computer Science', 90, 'scheduled', 'Arrays and functions');
      save();
      return mem;
    }

    function snapshot(l) {
      const s = mem.profiles.find(p => p.id === l.student_id);
      l.level_snapshot = s ? L.levelAt(s.level_base, s.level_base_year, L.dateISO(l.starts_at)) : null;
    }
    function money(id) {
      const l = mem.lessons.find(x => x.id === id); if (!l) return;
      const g = L.priceGroupFor(l.level_snapshot, mem.prices);
      const t = mem.profiles.find(p => p.id === l.teacher_id);
      mem.money[id] = {
        student_price: Math.round((g ? g.hourly_price : 0) * l.duration_min / 60 * 100) / 100,
        teacher_pay: Math.round((t ? t.pay_rate : 0) * l.duration_min / 60 * 100) / 100,
      };
    }
    const me = () => { const d = load(); return d.profiles.find(p => p.id === d.session) || null; };
    const role = () => me()?.role;

    function canSeeLesson(l) {
      const r = role(), id = load().session;
      return r === 'admin' || l.teacher_id === id || l.student_id === id;
    }

    function writeLesson(existing, patch) {
      const d = load(), r = role(), id = d.session;
      const l = existing ? { ...existing, ...patch } : {
        id: uid(), status: 'scheduled', topic: '', teacher_note: '', admin_note: '',
        created_by: id, created_at: new Date().toISOString(), ...patch,
      };
      if (r !== 'admin') {
        if (r !== 'teacher') fail('Only teachers and the admin can change lessons');
        if (!existing) { l.teacher_id = id; l.status = 'pending'; l.admin_note = ''; }
        else {
          if (existing.teacher_id !== id) fail('Not your lesson');
          if (['approved', 'cancelled'].includes(existing.status)) fail(`This lesson is already ${existing.status} and can't be changed. Ask the admin.`);
          l.teacher_id = existing.teacher_id; l.admin_note = existing.admin_note;
          if (!['scheduled', 'pending'].includes(l.status)) fail('Teachers can only mark lessons as done. The admin approves them.');
        }
        l.approved_at = null;
      } else {
        if (l.status === 'approved' && (!existing || existing.status !== 'approved')) l.approved_at = new Date().toISOString();
        else if (l.status !== 'approved') l.approved_at = null;
      }
      if (!d.profiles.some(p => p.id === l.student_id && p.role === 'student')) fail('Please choose a student');
      if (!d.profiles.some(p => p.id === l.teacher_id && ['teacher', 'admin'].includes(p.role))) fail('Please choose a teacher');
      const keyChanged = !existing || ['student_id', 'teacher_id', 'starts_at', 'duration_min'].some(k => existing[k] !== l[k]);
      if (!existing || existing.student_id !== l.student_id || existing.starts_at !== l.starts_at) snapshot(l);
      if (existing) d.lessons[d.lessons.indexOf(existing)] = l; else d.lessons.push(l);
      if (keyChanged) money(l.id);
      save();
      return clone(l);
    }

    return {
      mode: 'demo',

      async getSession() {
        const p = me();
        return p ? { user: { id: p.id }, profile: clone(p) } : null;
      },
      async signIn(username) {
        const d = load();
        const p = d.profiles.find(x => x.username === String(username).trim().toLowerCase());
        if (!p) fail('Invalid login credentials');
        d.session = p.id; save();
      },
      async signUp(f) {
        const d = load(), u = f.username.toLowerCase();
        if (d.profiles.some(p => p.username === u)) fail('User already registered');
        const lvl = f.account_type === 'teacher' ? null : (f.level ? Number(f.level) : null);
        const p = {
          id: uid(), username: u, role: f.account_type === 'teacher' ? 'pending_teacher' : 'student',
          first_name: f.first_name, last_name: f.last_name, phone: f.phone,
          level_base: lvl, level_base_year: lvl ? L.schoolYear(L.todayISO()) : null,
          math_units: lvl && f.math_units ? Number(f.math_units) : null, pay_rate: 0, notes: '',
          created_at: new Date().toISOString(),
        };
        d.profiles.push(p); d.session = p.id; save();
      },
      async signOut() { const d = load(); d.session = null; save(); },
      async changePassword() { /* demo: nothing to change */ },
      async resetDemo() { try { localStorage.removeItem(KEY); } catch { } mem = null; load(); },

      async listProfiles() {
        const d = load(), r = role(), id = d.session;
        return clone(d.profiles.filter(p => p.id === id || r === 'admin' || (r === 'teacher' && p.role === 'student')));
      },
      async listPeople() {
        return load().profiles.filter(p => ['admin', 'teacher'].includes(p.role))
          .map(({ id, first_name, last_name, role }) => ({ id, first_name, last_name, role }));
      },
      async updateProfile(id, patch) {
        const d = load(), r = role();
        const p = d.profiles.find(x => x.id === id);
        if (!p || (r !== 'admin' && id !== d.session)) fail('Not allowed');
        const allowed = r === 'admin' ? Object.keys(patch) : ['first_name', 'last_name', 'phone'];
        for (const k of allowed) if (k in patch) p[k] = patch[k];
        save();
        return clone(p);
      },

      async listLessons({ from, to, status, teacherId, studentId } = {}) {
        return clone(load().lessons
          .filter(canSeeLesson)
          .filter(l => (!from || l.starts_at >= from) && (!to || l.starts_at < to)
            && (!status || l.status === status) && (!teacherId || l.teacher_id === teacherId)
            && (!studentId || l.student_id === studentId))
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
      },
      async getLesson(id) { const l = load().lessons.find(x => x.id === id); return l && canSeeLesson(l) ? clone(l) : null; },
      async createLesson(data) { return writeLesson(null, data); },
      async updateLesson(id, patch) {
        const l = load().lessons.find(x => x.id === id);
        if (!l || !canSeeLesson(l)) fail('Lesson not found');
        return writeLesson(l, patch);
      },
      async updateLessons(ids, patch) {
        const out = [];
        for (const id of ids) out.push(await this.updateLesson(id, patch));
        return out;
      },
      async deleteLesson(id) {
        const d = load(), l = d.lessons.find(x => x.id === id), r = role();
        if (!l) return;
        const ok = r === 'admin' || (r === 'teacher' && l.teacher_id === d.session && l.created_by === d.session && ['pending', 'rejected'].includes(l.status));
        if (!ok) fail('You can only delete lessons you added that are not approved yet');
        d.lessons.splice(d.lessons.indexOf(l), 1); delete d.money[id]; save();
      },

      async listPrices() { return clone(load().prices); },
      async updatePrice(key, price) {
        if (role() !== 'admin') fail('Not allowed');
        const g = load().prices.find(x => x.key === key); if (g) g.hourly_price = price; save();
      },

      async lessonsWithMoney(from, to) {
        if (role() !== 'admin') fail('Not allowed');
        const d = load();
        return clone(d.lessons.filter(l => l.starts_at >= from && l.starts_at < to)
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
          .map(l => ({ ...l, ...(d.money[l.id] || { student_price: 0, teacher_pay: 0 }) })));
      },
      async recalcMoney(from, to) {
        if (role() !== 'admin') fail('Only the admin can do this');
        const d = load(); let n = 0;
        for (const l of d.lessons) if (l.starts_at >= from && l.starts_at < to) { snapshot(l); money(l.id); n++; }
        save(); return n;
      },

      async myMonthSummary(y, m) {
        const d = load(), id = d.session;
        const [from, to] = L.monthRange(`${y}-${L.pad(m)}`);
        const ls = d.lessons.filter(l => l.teacher_id === id && l.status === 'approved' && l.starts_at >= from && l.starts_at < to);
        return {
          lessons: ls.length,
          minutes: ls.reduce((s, l) => s + l.duration_min, 0),
          pay: ls.reduce((s, l) => s + (d.money[l.id]?.teacher_pay || 0), 0),
        };
      },
    };
  },
};
