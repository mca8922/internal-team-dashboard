/**
 * Adds 25 mock team members styled as a real Indian CA (Chartered Accountancy)
 * firm — mirrors the existing board (Rajesh Bohra / Dharmesh Bohra @ mca.net.in).
 * Creates auth users + patches their profile rows (department, job title,
 * manager flags, joined dates, internship length). Writes every created id to
 * scripts/_members_manifest.json for the goals seed + later cleanup.
 *
 * Run:  npx tsx scripts/_add_members.tmp.ts
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

config({ path: '.env' });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

type Role = 'board' | 'fte' | 'pte' | 'intern';

interface Member {
  key: string;
  name: string;
  email: string;
  role: Role;
  department: string;
  jobTitle: string;
  joinedDaysAgo: number;
  isManager?: boolean;
  managedDepartment?: string;
  managerKey?: string; // resolved to manager_id after creation
  internshipMonths?: number;
  dailyTargetHours?: number;
}

const DEPTS = {
  AUDIT: 'Audit & Assurance',
  DTAX: 'Direct Taxation',
  GST: 'GST & Indirect Taxation',
  ROC: 'Company Law & ROC Compliance',
  ACCT: 'Accounts & Bookkeeping',
  RISK: 'Internal Audit & Risk Advisory',
  ADMIN: 'Client Advisory & Admin',
};

const MEMBERS: Member[] = [
  // ── Audit & Assurance (5) ──────────────────────────────────────────────
  { key: 'priya', name: 'Priya Mehta', email: 'priya.mehta@mca.net.in', role: 'fte', department: DEPTS.AUDIT, jobTitle: 'Manager – Audit & Assurance', joinedDaysAgo: 1460, isManager: true, managedDepartment: DEPTS.AUDIT },
  { key: 'rohan', name: 'Rohan Kulkarni', email: 'rohan.kulkarni@mca.net.in', role: 'fte', department: DEPTS.AUDIT, jobTitle: 'Senior Audit Associate', joinedDaysAgo: 900, managerKey: 'priya' },
  { key: 'sneha', name: 'Sneha Iyer', email: 'sneha.iyer@mca.net.in', role: 'fte', department: DEPTS.AUDIT, jobTitle: 'Audit Associate', joinedDaysAgo: 520, managerKey: 'priya' },
  { key: 'aditya_s', name: 'Aditya Shah', email: 'aditya.shah@mca.net.in', role: 'pte', department: DEPTS.AUDIT, jobTitle: 'Audit Associate (Part-Time)', joinedDaysAgo: 300, managerKey: 'priya', dailyTargetHours: 5 },
  { key: 'kavya', name: 'Kavya Nair', email: 'kavya.nair@mca.net.in', role: 'intern', department: DEPTS.AUDIT, jobTitle: 'Article Assistant', joinedDaysAgo: 210, managerKey: 'priya', internshipMonths: 36 },

  // ── Direct Taxation (4) ────────────────────────────────────────────────
  { key: 'vikram', name: 'Vikram Sharma', email: 'vikram.sharma@mca.net.in', role: 'fte', department: DEPTS.DTAX, jobTitle: 'Manager – Direct Taxation', joinedDaysAgo: 1650, isManager: true, managedDepartment: DEPTS.DTAX },
  { key: 'neha', name: 'Neha Agarwal', email: 'neha.agarwal@mca.net.in', role: 'fte', department: DEPTS.DTAX, jobTitle: 'Senior Tax Associate', joinedDaysAgo: 760, managerKey: 'vikram' },
  { key: 'karan', name: 'Karan Malhotra', email: 'karan.malhotra@mca.net.in', role: 'fte', department: DEPTS.DTAX, jobTitle: 'Tax Associate', joinedDaysAgo: 400, managerKey: 'vikram' },
  { key: 'ishita', name: 'Ishita Verma', email: 'ishita.verma@mca.net.in', role: 'intern', department: DEPTS.DTAX, jobTitle: 'Article Assistant', joinedDaysAgo: 150, managerKey: 'vikram', internshipMonths: 36 },

  // ── GST & Indirect Taxation (4) ────────────────────────────────────────
  { key: 'ananya', name: 'Ananya Joshi', email: 'ananya.joshi@mca.net.in', role: 'fte', department: DEPTS.GST, jobTitle: 'Manager – GST & Indirect Taxation', joinedDaysAgo: 1300, isManager: true, managedDepartment: DEPTS.GST },
  { key: 'siddharth', name: 'Siddharth Rao', email: 'siddharth.rao@mca.net.in', role: 'fte', department: DEPTS.GST, jobTitle: 'Senior GST Associate', joinedDaysAgo: 680, managerKey: 'ananya' },
  { key: 'meera', name: 'Meera Pillai', email: 'meera.pillai@mca.net.in', role: 'pte', department: DEPTS.GST, jobTitle: 'GST Associate (Part-Time)', joinedDaysAgo: 250, managerKey: 'ananya', dailyTargetHours: 5 },
  { key: 'yash', name: 'Yash Trivedi', email: 'yash.trivedi@mca.net.in', role: 'intern', department: DEPTS.GST, jobTitle: 'Article Assistant', joinedDaysAgo: 90, managerKey: 'ananya', internshipMonths: 36 },

  // ── Company Law & ROC Compliance (3) ───────────────────────────────────
  { key: 'kunal', name: 'Kunal Desai', email: 'kunal.desai@mca.net.in', role: 'fte', department: DEPTS.ROC, jobTitle: 'Manager – Company Law & ROC Compliance', joinedDaysAgo: 1100, isManager: true, managedDepartment: DEPTS.ROC },
  { key: 'riya', name: 'Riya Kapoor', email: 'riya.kapoor@mca.net.in', role: 'fte', department: DEPTS.ROC, jobTitle: 'Compliance Associate', joinedDaysAgo: 430, managerKey: 'kunal' },
  { key: 'devansh', name: 'Devansh Patel', email: 'devansh.patel@mca.net.in', role: 'intern', department: DEPTS.ROC, jobTitle: 'Article Assistant', joinedDaysAgo: 60, managerKey: 'kunal', internshipMonths: 36 },

  // ── Accounts & Bookkeeping (4) ─────────────────────────────────────────
  { key: 'pooja', name: 'Pooja Bhatt', email: 'pooja.bhatt@mca.net.in', role: 'fte', department: DEPTS.ACCT, jobTitle: 'Manager – Accounts & Bookkeeping', joinedDaysAgo: 1550, isManager: true, managedDepartment: DEPTS.ACCT },
  { key: 'manish', name: 'Manish Gupta', email: 'manish.gupta@mca.net.in', role: 'fte', department: DEPTS.ACCT, jobTitle: 'Senior Accountant', joinedDaysAgo: 820, managerKey: 'pooja' },
  { key: 'tanvi', name: 'Tanvi Solanki', email: 'tanvi.solanki@mca.net.in', role: 'fte', department: DEPTS.ACCT, jobTitle: 'Accountant', joinedDaysAgo: 340, managerKey: 'pooja' },
  { key: 'arjun', name: 'Arjun Menon', email: 'arjun.menon@mca.net.in', role: 'pte', department: DEPTS.ACCT, jobTitle: 'Accountant (Part-Time)', joinedDaysAgo: 180, managerKey: 'pooja', dailyTargetHours: 4 },

  // ── Internal Audit & Risk Advisory (3) ─────────────────────────────────
  { key: 'rahul', name: 'Rahul Chawla', email: 'rahul.chawla@mca.net.in', role: 'fte', department: DEPTS.RISK, jobTitle: 'Manager – Internal Audit & Risk Advisory', joinedDaysAgo: 1200, isManager: true, managedDepartment: DEPTS.RISK },
  { key: 'divya', name: 'Divya Reddy', email: 'divya.reddy@mca.net.in', role: 'fte', department: DEPTS.RISK, jobTitle: 'Risk Advisory Associate', joinedDaysAgo: 500, managerKey: 'rahul' },
  { key: 'aryan', name: 'Aryan Bose', email: 'aryan.bose@mca.net.in', role: 'intern', department: DEPTS.RISK, jobTitle: 'Article Assistant', joinedDaysAgo: 45, managerKey: 'rahul', internshipMonths: 36 },

  // ── Client Advisory & Admin (2) ─────────────────────────────────────────
  { key: 'simran', name: 'Simran Kaur', email: 'simran.kaur@mca.net.in', role: 'fte', department: DEPTS.ADMIN, jobTitle: 'Client Relations & Office Manager', joinedDaysAgo: 1000 },
  { key: 'farhan', name: 'Farhan Sheikh', email: 'farhan.sheikh@mca.net.in', role: 'pte', department: DEPTS.ADMIN, jobTitle: 'Front Office Executive (Part-Time)', joinedDaysAgo: 220, managerKey: 'simran', dailyTargetHours: 4 },
];

function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const manifest: { userIdByKey: Record<string, string>; createdAt: string } = {
  userIdByKey: {},
  createdAt: new Date().toISOString(),
};

async function main() {
  for (const m of MEMBERS) {
    const password = randomBytes(12).toString('base64url');
    const { data, error } = await admin.auth.admin.createUser({
      email: m.email,
      password,
      email_confirm: true,
      user_metadata: { name: m.name, role: m.role, department: m.department },
    });
    if (error) throw new Error(`createUser ${m.email}: ${error.message}`);
    const id = data.user!.id;
    manifest.userIdByKey[m.key] = id;
    console.log(`  created ${m.email} -> ${id}`);
  }

  // Give the trigger a moment to insert every profile row.
  await new Promise((r) => setTimeout(r, 1200));

  for (const m of MEMBERS) {
    const id = manifest.userIdByKey[m.key];
    const patch: Record<string, unknown> = {
      confirmed_by_board: true,
      job_title: m.jobTitle,
      joined_date: isoDate(m.joinedDaysAgo),
    };
    if (m.isManager) {
      patch.is_manager = true;
      patch.managed_department = m.managedDepartment;
    }
    if (m.managerKey) {
      patch.manager_id = manifest.userIdByKey[m.managerKey];
    }
    if (m.internshipMonths) patch.internship_months = m.internshipMonths;
    if (m.dailyTargetHours) patch.daily_target_hours = m.dailyTargetHours;

    const { error } = await admin.from('profiles').update(patch).eq('id', id);
    if (error) throw new Error(`patch profile ${m.email}: ${error.message}`);
  }

  // Seed the departments table (colours) for every new department.
  const deptColors: Record<string, string> = {
    [DEPTS.AUDIT]: '#288A5D',
    [DEPTS.DTAX]: '#B45309',
    [DEPTS.GST]: '#1D4ED8',
    [DEPTS.ROC]: '#7C3AED',
    [DEPTS.ACCT]: '#0891B2',
    [DEPTS.RISK]: '#DC2626',
    [DEPTS.ADMIN]: '#4B5563',
  };
  for (const [name, color] of Object.entries(deptColors)) {
    await admin.from('departments').upsert({ name, color }, { onConflict: 'name' });
  }

  writeFileSync(join(process.cwd(), 'scripts', '_members_manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n✅ Created ${MEMBERS.length} members.`);
  console.log('   Manifest -> scripts/_members_manifest.json');
}

main().catch((e) => {
  console.error('\n❌', e.message || e);
  process.exit(1);
});
