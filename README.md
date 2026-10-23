# Tutoring Center website — setup guide

Everything here is **free**: Supabase (database + logins) and GitHub Pages (hosting).
Take it one step at a time. It takes about 30–45 minutes the first time.

---

## Step 0 — Try the demo first (2 minutes)

Open `index.html` in your browser (double-click it). Because the settings are still
empty, it runs in **demo mode** with fake data. Press "Admin", "Teacher" or "Student"
to see each screen. Nothing is sent anywhere.

---

## Step 1 — Create your free Supabase project

1. Go to **supabase.com** → *Start your project* → sign up (you can use your Google account).
2. Press **New project**.
   - Name: `tutoring-center`
   - Database password: press *Generate* and **save it somewhere safe**.
   - Region: **Central EU (Frankfurt)** (closest to Israel).
   - Plan: **Free**.
3. Wait 1–2 minutes until the project is ready.

## Step 2 — Create the database

1. In the left menu open **SQL Editor** → **New query**.
2. Open the file `supabase/schema.sql`, copy **everything**, paste it in, press **Run**.
3. You should see "Success. No rows returned".

## Step 3 — Turn off email confirmation

Your site uses usernames, not real emails, so confirmation emails must be off.

1. Left menu → **Authentication** → **Sign In / Providers** (or *Providers*) → **Email**.
2. Turn **OFF** "Confirm email". Press **Save**.

## Step 4 — Connect the website to Supabase

1. Left menu → **Project Settings** → **API** (or press the **Connect** button at the top).
2. Copy the **Project URL** and the **anon public** key (newer projects call it *publishable key*).
3. Open `js/config.js` in any text editor (Notepad is fine) and paste them:

```js
SUPABASE_URL: 'https://abcdefgh.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...or sb_publishable_...',
```

4. While you're there, change `SITE_NAME` to your center's name. Save the file.

> The anon/publishable key is safe to be public. The database rules (in `schema.sql`)
> decide who can see what. **Never** put the `service_role` / secret key in the website.

## Step 5 — Put the website online (GitHub Pages)

1. Create a free account on **github.com**.
2. Press **+** (top right) → **New repository** → name it `tutoring-center` → **Public** → *Create repository*.
3. Press **uploading an existing file**, then drag in **everything inside** this folder
   (`index.html`, the `css`, `js` and `supabase` folders, and this `README.md`). Press **Commit changes**.
4. In the repository: **Settings** → **Pages** → under *Branch* choose **main** and **/(root)** → **Save**.
5. After 1–2 minutes your site is live at
   `https://YOUR-GITHUB-NAME.github.io/tutoring-center/`

To change the site later: edit the file on GitHub (pencil icon) or upload the new version. It updates in about a minute.

## Step 6 — Make yourself the admin

1. Open your live site → **Sign up** → choose **I'm a teacher** → pick your username and password.
   (You'll see "Waiting for approval" — that's expected.)
2. In Supabase → **SQL Editor** → new query → run (with **your** username):

```sql
update public.profiles set role = 'admin' where username = 'your-username';
```

3. Back on the site press **Check again**. You're the admin. 🎉

## Step 7 — Start using it

- **Prices**: open the *Prices* tab and set the price per hour for each grade group.
- **Teachers**: send them the link. They sign up with *I'm a teacher*, then you approve
  them in the *Teachers* tab and set their pay per hour.
- **Students**: send them the link. They sign up with their name, phone, grade and
  (for grades 10–12) math bagrut units.
- **Planner**: add lessons for each teacher. Teachers see their day in *My day*,
  students see their lessons and what to prepare.
- **Approvals**: when a teacher marks a lesson as done (or adds one), it waits for you.
  Approve it, or send it back with a note.
- **Monthly report**: how much to pay each teacher and how much to collect from each
  student. Download as a spreadsheet (CSV opens in Excel / Google Sheets).

---

## How the rules work

| Thing | Rule |
|---|---|
| Grades | Go up by one automatically every **September 1st**. After grade 12 (or after college 1st year) → **Graduated**. You can always fix a grade in *Students → Edit*. |
| Prices | By the student's grade **on the lesson date**. A 90-minute lesson = 1.5 × the hourly price. |
| Lesson statuses | Planned → (teacher: *Mark as done*) → Waiting for approval → (you) Approved / Sent back. |
| Money | Only **approved** lessons count. Teachers see only their own pay. Students never see money. |
| Changing prices | Doesn't change old lessons. In the *Monthly report* press **Recalculate prices** to apply new prices to that month. |

---

## Common questions

**Someone forgot their password.**
In Supabase → SQL Editor run (change the new password and the username):

```sql
update auth.users
set encrypted_password = extensions.crypt('NewPassword123', extensions.gen_salt('bf'))
where email = 'their-username@users.tutoring-center.app';
```

Then they log in and change it in *My account*.

**Sign up says the email/domain is invalid.**
Change `USERNAME_EMAIL_DOMAIN` in `js/config.js` to another made-up address
ending, for example `students.mytutor.co.il`. (Do this before people sign up — changing it
later means existing users can't log in.)

**The site says "Supabase project paused".**
Free Supabase projects pause after a week with **no visits at all**. Open your Supabase
dashboard and press **Restore**. Normal daily use keeps it awake.

**I want it in Hebrew or Arabic / I want new features.**
Bring this folder (or your GitHub link) back to Claude and ask. 🙂

---

## Files

```
index.html            the page
css/style.css         colors and layout
js/config.js          YOUR SETTINGS (Supabase keys, name, subjects)
js/app.js             all the screens
js/logic.js           dates, school year, grades
js/api-supabase.js    talks to the database
js/api-demo.js        the demo with fake data
supabase/schema.sql   database tables + security rules (run once)
```
