// Live mode: talks to your Supabase project.
window.SupabaseApi = {
  create(C) {
    const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
    const emailOf = u => `${String(u).trim().toLowerCase()}@${C.USERNAME_EMAIL_DOMAIN}`;
    const chk = ({ data, error }) => { if (error) throw error; return data; };

    return {
      mode: 'live',

      async getSession() {
        const { data } = await sb.auth.getSession();
        if (!data.session) return null;
        const user = data.session.user;
        const profile = chk(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle());
        return { user, profile };
      },

      async signIn(username, password) {
        chk(await sb.auth.signInWithPassword({ email: emailOf(username), password }));
      },

      async signUp(f) {
        const r = await sb.auth.signUp({
          email: emailOf(f.username),
          password: f.password,
          options: {
            data: {
              username: f.username.toLowerCase(),
              first_name: f.first_name, last_name: f.last_name, phone: f.phone,
              account_type: f.account_type,
              level: f.level ? String(f.level) : '',
              math_units: f.math_units ? String(f.math_units) : '',
            },
          },
        });
        if (r.error) throw r.error;
        if (!r.data.session) throw new Error('CONFIRM_EMAIL_ON');
      },

      async signOut() { await sb.auth.signOut(); },

      async changePassword(pw) { chk(await sb.auth.updateUser({ password: pw })); },

      async listProfiles() { return chk(await sb.from('profiles').select('*').order('first_name')); },
      async listPeople() { return chk(await sb.from('people').select('*')); },
      async updateProfile(id, patch) {
        return chk(await sb.from('profiles').update(patch).eq('id', id).select().single());
      },

      async listLessons({ from, to, status, teacherId, studentId } = {}) {
        let q = sb.from('lessons').select('*').order('starts_at');
        if (from) q = q.gte('starts_at', from);
        if (to) q = q.lt('starts_at', to);
        if (status) q = q.eq('status', status);
        if (teacherId) q = q.eq('teacher_id', teacherId);
        if (studentId) q = q.eq('student_id', studentId);
        return chk(await q);
      },
      async getLesson(id) { return chk(await sb.from('lessons').select('*').eq('id', id).maybeSingle()); },
      async createLesson(d) { return chk(await sb.from('lessons').insert(d).select().single()); },
      async updateLesson(id, p) { return chk(await sb.from('lessons').update(p).eq('id', id).select().single()); },
      async updateLessons(ids, p) { return chk(await sb.from('lessons').update(p).in('id', ids).select()); },
      async deleteLesson(id) { chk(await sb.from('lessons').delete().eq('id', id)); },

      async listPrices() { return chk(await sb.from('price_groups').select('*').order('sort')); },
      async updatePrice(key, price) {
        chk(await sb.from('price_groups').update({ hourly_price: price }).eq('key', key));
      },

      // Admin: lessons in a range with their money row
      async lessonsWithMoney(from, to) {
        const rows = chk(await sb.from('lessons').select('*, lesson_money(*)')
          .gte('starts_at', from).lt('starts_at', to).order('starts_at'));
        return rows.map(r => {
          const m = Array.isArray(r.lesson_money) ? r.lesson_money[0] : r.lesson_money;
          return { ...r, student_price: Number(m?.student_price || 0), teacher_pay: Number(m?.teacher_pay || 0) };
        });
      },
      async recalcMoney(from, to) { return chk(await sb.rpc('recalc_money', { p_from: from, p_to: to })); },

      async myMonthSummary(y, m) {
        const d = chk(await sb.rpc('my_month_summary', { p_year: y, p_month: m }));
        const r = (Array.isArray(d) ? d[0] : d) || {};
        return { lessons: r.lessons || 0, minutes: r.minutes || 0, pay: Number(r.pay || 0) };
      },
    };
  },
};
