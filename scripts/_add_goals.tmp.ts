/**
 * Seeds goals (yearly -> monthly -> weekly -> daily) for the 25 mock CA-firm
 * team members created by _add_members.tmp.ts, assigned/reviewed by the two
 * real board partners (Rajesh Bohra, Dharmesh Bohra). Covers every status,
 * every recurrence, multi-assignee and multi-department goals, work reports
 * and star reviews. Every inserted id goes into scripts/_goals_manifest.json.
 *
 * Run:  npx tsx scripts/_add_goals.tmp.ts
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

config({ path: '.env' });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const manifestIn = JSON.parse(readFileSync(join(process.cwd(), 'scripts', '_members_manifest.json'), 'utf8'));
const P: Record<string, string> = manifestIn.userIdByKey;

// Board partners (real accounts already in the DB).
const RAJESH = '21984019-ddda-42ac-9f10-191928c6c49e';
const DHARMESH = '83d48348-eddf-4ec7-a72f-fdc1392beb59';

const D = {
  AUDIT: 'Audit & Assurance',
  DTAX: 'Direct Taxation',
  GST: 'GST & Indirect Taxation',
  ROC: 'Company Law & ROC Compliance',
  ACCT: 'Accounts & Bookkeeping',
  RISK: 'Internal Audit & Risk Advisory',
  ADMIN: 'Client Advisory & Admin',
};

function iso(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
function ts(offsetDays: number, hour = 12): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
}

type Rec = 'once' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';
interface Review { by: string; stars: number; comment: string; after?: number }
interface Report { by: string; on: number; body: string; reviews?: Review[]; complete?: boolean }
interface Item {
  label: string; desc?: string; rec: Rec; recurDays?: number[];
  report?: boolean; done?: { by: string; on: number }[]; reports?: Report[];
}
interface GoalSpec {
  key: string; level: 'yearly' | 'monthly' | 'weekly' | 'daily'; title: string; desc?: string;
  due: number | null; dept: string; depts?: string[];
  status: 'active' | 'inactive' | 'achieved' | 'not_met';
  by: string; assignees: string[]; parent?: string; progress: number; items?: Item[];
}

const P_ = (s: string) => `<p>${s}</p>`;
const UL = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

const GOALS: GoalSpec[] = [
  // ═══ Audit & Assurance — full yearly→monthly→weekly→daily cascade ═══
  { key: 'audit-y', level: 'yearly', title: 'Statutory Audit Excellence FY26', desc: P_('Deliver every statutory audit with zero re-openings and faster turnaround than FY25.'), due: 200, dept: D.AUDIT, status: 'active', by: RAJESH, assignees: [P.priya, P.rohan], progress: 30 },
  { key: 'audit-m', level: 'monthly', title: 'July — Bank Audit Season Closure', parent: 'audit-y', desc: P_('Close all assigned bank branch audits before the RBI deadline.'), due: 14, dept: D.AUDIT, status: 'active', by: DHARMESH, assignees: [P.priya, P.rohan, P.sneha], progress: 55,
    items: [
      { label: 'Finalize branch audit checklist', desc: P_('Lock the LFAR + tax-audit checklist for this cycle.'), rec: 'once', done: [{ by: P.priya, on: -6 }] },
      { label: 'Weekly audit status report', desc: P_('Branches closed, open queries, NPA flags.'), rec: 'weekly', report: true,
        reports: [
          { by: P.priya, on: -3, complete: true, body: P_('Closed 6 of 9 branches.') + UL(['2 branches have NPA-classification queries pending', 'LFAR drafted for all closed branches']),
            reviews: [{ by: RAJESH, stars: 4, comment: 'Good pace. Get the NPA queries resolved with the branch managers by Friday.' }] },
          { by: P.rohan, on: -3, body: P_('Reviewed 3 branches — found one provisioning gap of ₹4.2L.'),
            reviews: [{ by: DHARMESH, stars: 4, comment: 'Sharp catch on the provisioning gap. Document it clearly for the LFAR.' }] },
        ] },
    ] },
  { key: 'audit-w', level: 'weekly', title: 'Sprint — XYZ Pvt Ltd Statutory Audit', parent: 'audit-m', desc: P_('Field work + working papers for the XYZ Pvt Ltd FY25-26 audit.'), due: 3, dept: D.AUDIT, status: 'active', by: P.priya, assignees: [P.sneha, P.kavya], progress: 60,
    items: [
      { label: 'Daily fieldwork note', desc: P_('Vouching progress, queries raised, documents pending from client.'), rec: 'weekdays', report: true,
        reports: [
          { by: P.sneha, on: -2, complete: true, body: P_('Completed vouching for purchases and fixed assets; 2 invoices missing.'),
            reviews: [{ by: P.priya, stars: 4, comment: 'Good coverage. Chase the two missing invoices before we finalize.' }] },
          { by: P.kavya, on: -1, body: P_('Assisted with bank reconciliation — one unexplained difference of ₹18,400.'),
            reviews: [{ by: P.priya, stars: 3, comment: 'Trace that difference to source before Friday — likely a timing entry.' }] },
        ] },
      { label: 'Draft management letter points', rec: 'once', done: [{ by: P.sneha, on: -1 }] },
    ] },
  { key: 'audit-d', level: 'daily', title: 'Today — Clear XYZ Bank Reconciliation Query', parent: 'audit-w', desc: P_('Resolve the ₹18,400 unexplained bank reconciliation difference.'), due: 0, dept: D.AUDIT, status: 'active', by: P.priya, assignees: [P.kavya], progress: 100,
    items: [
      { label: 'Trace and clear the difference', rec: 'daily', report: true,
        reports: [ { by: P.kavya, on: 0, complete: true, body: P_('Traced it to a cheque issued but not presented; reconciliation now ties out.'),
          reviews: [{ by: P.priya, stars: 5, comment: 'Well traced — clean handling for your first standalone reconciliation. ⭐' }] } ] },
    ] },
  { key: 'audit-overdue', level: 'weekly', title: 'Trust Audit — ABC Charitable Trust', desc: P_('Overdue — Form 10B filing deadline slipped.'), due: -5, dept: D.AUDIT, status: 'active', by: DHARMESH, assignees: [P.rohan], progress: 40,
    items: [ { label: 'Complete trust audit & Form 10B', rec: 'once', report: true,
      reports: [ { by: P.rohan, on: -6, body: P_('Audit complete; awaiting the trust’s digital signature to file Form 10B.'),
        reviews: [{ by: RAJESH, stars: 2, comment: 'This is now overdue — call the trustee directly today and get the DSC issue resolved.' }] } ] } ] },
  { key: 'audit-achieved', level: 'weekly', title: 'Peer Review Readiness', desc: P_('ICAI peer review — passed with no material observations.'), due: -10, dept: D.AUDIT, status: 'achieved', by: RAJESH, assignees: [P.priya, P.rohan], progress: 100,
    items: [ { label: 'Complete peer review documentation', rec: 'once', report: true,
      reports: [ { by: P.priya, on: -12, complete: true, body: P_('Peer reviewer signed off with zero material observations.') + UL(['Quality control manual updated', 'All working paper templates standardized']),
        reviews: [{ by: RAJESH, stars: 5, comment: 'Outstanding result — this protects the firm’s standing. ⭐' }] } ] } ] },
  { key: 'audit-inactive', level: 'monthly', title: 'Explore CAAT / Data Analytics Tools', desc: P_('Parked — revisit after this audit season.'), due: 40, dept: D.AUDIT, status: 'inactive', by: DHARMESH, assignees: [P.rohan], progress: 0,
    items: [ { label: 'Shortlist 3 CAAT tools', rec: 'once' } ] },

  // ═══ Direct Taxation ═══
  { key: 'dtax-y', level: 'yearly', title: 'Zero Late Filings — Direct Tax FY26', desc: P_('Every ITR and tax audit report filed before due date, no penalty notices.'), due: 220, dept: D.DTAX, status: 'active', by: RAJESH, assignees: [P.vikram], progress: 25 },
  { key: 'dtax-m', level: 'monthly', title: 'July — Tax Audit Report Season', parent: 'dtax-y', desc: P_('Complete Form 3CD tax audits for all assigned clients before the extended deadline.'), due: 16, dept: D.DTAX, status: 'active', by: P.vikram, assignees: [P.neha, P.karan, P.ishita], progress: 50,
    items: [
      { label: 'Daily 3CD filing log', desc: P_('Clients completed, clauses flagged, pending clarifications.'), rec: 'daily', report: true,
        reports: [
          { by: P.neha, on: -1, complete: true, body: P_('Filed 3 tax audit reports today; flagged one client for disallowance under 40A(3).'),
            reviews: [{ by: P.vikram, stars: 4, comment: 'Good catch on 40A(3) — send the client a note before we finalize.' }] },
          { by: P.karan, on: -1, body: P_('2 reports filed; one client still hasn’t shared fixed-asset register.'),
            reviews: [{ by: P.vikram, stars: 3, comment: 'Follow up with the client today — we’re cutting it close on the deadline.' }] },
          { by: P.ishita, on: -2, body: P_('Prepared depreciation schedules for 4 clients under the Income Tax Act rates.'),
            reviews: [{ by: P.neha, stars: 4, comment: 'Clean schedules, well cross-checked against the companies act rates too.' }] },
        ] },
    ] },
  { key: 'dtax-w', level: 'weekly', title: 'Sprint — Advance Tax Working Q1', parent: 'dtax-m', desc: P_('Compute and communicate advance tax liability to top 20 clients.'), due: 4, dept: D.DTAX, status: 'active', by: P.vikram, assignees: [P.karan, P.ishita], progress: 45,
    items: [ { label: 'Client advance-tax computation', rec: 'weekdays', report: true,
      reports: [ { by: P.karan, on: -1, body: P_('Computed and shared advance tax working for 6 clients.'),
        reviews: [{ by: P.vikram, stars: 4, comment: 'Good throughput — make sure the interest u/s 234B/C is shown separately.' }] } ] } ] },
  { key: 'dtax-notmet', level: 'monthly', title: 'June — TDS Return Corrections', desc: P_('Missed — 2 correction statements still pending, closed as not met.'), due: -8, dept: D.DTAX, status: 'not_met', by: RAJESH, assignees: [P.neha], progress: 60,
    items: [ { label: 'File TDS correction statements', rec: 'once', report: true,
      reports: [ { by: P.neha, on: -14, body: P_('Filed 3 of 5 corrections; 2 are stuck on TRACES justification report mismatches.'),
        reviews: [{ by: RAJESH, stars: 2, comment: 'We fell short this month — escalate the TRACES issue to the department liaison and carry this forward with a firm date.' }] } ] } ] },
  { key: 'dtax-overdue', level: 'weekly', title: 'Respond to Section 143(1) Notice — Sharma Traders', desc: P_('Overdue response window.'), due: -3, dept: D.DTAX, status: 'active', by: P.vikram, assignees: [P.karan], progress: 30,
    items: [ { label: 'Draft & file notice response', rec: 'once', report: true,
      reports: [ { by: P.karan, on: -5, body: P_('Draft response ready; waiting on client to confirm the TDS credit mismatch figures.'),
        reviews: [{ by: P.vikram, stars: 2, comment: 'This has slipped past the window — file with whatever figures we have today and supplement later if needed.' }] } ] } ] },
  { key: 'dtax-achieved', level: 'weekly', title: 'Transfer Pricing Study — GlobalTech India', desc: P_('TP study and Form 3CEB filed on time.'), due: -9, dept: D.DTAX, status: 'achieved', by: RAJESH, assignees: [P.vikram, P.neha], progress: 100,
    items: [ { label: 'Complete TP benchmarking & Form 3CEB', rec: 'once', report: true,
      reports: [ { by: P.neha, on: -11, complete: true, body: P_('Benchmarking study complete using 5 comparables; Form 3CEB filed.'),
        reviews: [{ by: RAJESH, stars: 5, comment: 'Very thorough benchmarking set. ⭐ Great work under a tight timeline.' }] } ] } ] },

  // ═══ GST & Indirect Taxation ═══
  { key: 'gst-y', level: 'yearly', title: 'GST Compliance Automation 2026', desc: P_('Automate GSTR-1/3B reconciliation for all retainer clients.'), due: 210, dept: D.GST, status: 'active', by: DHARMESH, assignees: [P.ananya, P.siddharth], progress: 35 },
  { key: 'gst-m', level: 'monthly', title: 'July — GSTR-3B & ITC Reconciliation', parent: 'gst-y', desc: P_('Reconcile GSTR-2B vs purchase register for every retainer client before filing.'), due: 10, dept: D.GST, status: 'active', by: P.ananya, assignees: [P.siddharth, P.meera, P.yash], progress: 60,
    items: [
      { label: 'Weekly ITC mismatch report', desc: P_('Vendor-wise mismatches and follow-up status.'), rec: 'weekly', report: true,
        reports: [
          { by: P.siddharth, on: -3, complete: true, body: P_('Reconciled 14 clients — ITC mismatch reduced to 2.1% from 6% last month.'),
            reviews: [{ by: P.ananya, stars: 5, comment: 'Great improvement in the mismatch rate. ⭐ Keep the vendor follow-up tracker updated.' }] },
          { by: P.meera, on: -3, body: P_('Flagged 5 vendors not filing GSTR-1 on time; drafted reminder emails.'),
            reviews: [{ by: DHARMESH, stars: 4, comment: 'Good proactive flagging — cc me on the reminder emails going forward.' }] },
        ] },
      { label: 'File GSTR-3B for all clients', rec: 'monthly', report: true,
        reports: [ { by: P.siddharth, on: -1, complete: true, body: P_('All 22 retainer clients filed before the 20th.'),
          reviews: [{ by: P.ananya, stars: 4, comment: 'On time across the board — nice.' }] } ] },
    ] },
  { key: 'gst-w', level: 'weekly', title: 'Sprint — E-way Bill Audit for Manufacturing Clients', parent: 'gst-m', desc: P_('Check E-way bill vs invoice value discrepancies for 3 manufacturing clients.'), due: 2, dept: D.GST, status: 'active', by: P.ananya, assignees: [P.yash], progress: 50,
    items: [ { label: 'Daily discrepancy log', rec: 'weekdays', report: true,
      reports: [ { by: P.yash, on: -1, body: P_('Checked 40 e-way bills; found 3 value mismatches over 10%.'),
        reviews: [{ by: P.siddharth, stars: 4, comment: 'Good sample size. Get the client to explain those 3 before we close.' }] } ] } ] },
  { key: 'gst-notice', level: 'weekly', title: 'GST Audit Notice — DEF Enterprises', desc: P_('Departmental audit notice under Section 65 — overdue reply.'), due: -4, dept: D.GST, status: 'active', by: DHARMESH, assignees: [P.siddharth], progress: 35,
    items: [ { label: 'Prepare reply to Section 65 notice', rec: 'once', report: true,
      reports: [ { by: P.siddharth, on: -6, body: P_('Reply drafted; compiling supporting invoices for the ITC claimed.'),
        reviews: [{ by: DHARMESH, stars: 3, comment: 'We’re close to the deadline — submit tomorrow even if a few annexures follow later.' }] } ] } ] },
  { key: 'gst-achieved', level: 'weekly', title: 'GST Refund — Export Client Filed & Sanctioned', desc: P_('₹9.6L IGST refund sanctioned.'), due: -15, dept: D.GST, status: 'achieved', by: P.ananya, assignees: [P.siddharth], progress: 100,
    items: [ { label: 'File & follow up refund application', rec: 'once', report: true,
      reports: [ { by: P.siddharth, on: -18, complete: true, body: P_('Refund of ₹9.6L sanctioned within 30 days of filing.'),
        reviews: [{ by: RAJESH, stars: 5, comment: 'Fast turnaround on the refund — client will be thrilled. ⭐' }] } ] } ] },
  { key: 'gst-inactive', level: 'monthly', title: 'Evaluate GST Suvidha Kendra Partnership', desc: P_('Inactive — needs a clearer business case.'), due: 30, dept: D.GST, status: 'inactive', by: DHARMESH, assignees: [P.ananya], progress: 0,
    items: [ { label: 'Draft partnership proposal', rec: 'once' } ] },

  // ═══ Company Law & ROC Compliance ═══
  { key: 'roc-m', level: 'monthly', title: 'Annual ROC Filing Season', desc: P_('AOC-4 and MGT-7 for all corporate clients before the deadline.'), due: 20, dept: D.ROC, status: 'active', by: RAJESH, assignees: [P.kunal, P.riya, P.devansh], progress: 40,
    items: [
      { label: 'Weekly filing status report', rec: 'weekly', report: true,
        reports: [
          { by: P.kunal, on: -3, complete: true, body: P_('Filed AOC-4 for 18 of 30 companies; MGT-7 drafted for 12.'),
            reviews: [{ by: RAJESH, stars: 4, comment: 'Good progress — prioritise the ones with upcoming AGM deadlines next.' }] },
          { by: P.riya, on: -3, body: P_('Held 3 board meetings for clients and prepared minutes + resolutions.'),
            reviews: [{ by: P.kunal, stars: 4, comment: 'Well drafted resolutions — get them signed within 30 days as required.' }] },
        ] },
      { label: 'DIN KYC verification for all directors', rec: 'once', done: [{ by: P.devansh, on: -4 }] },
    ] },
  { key: 'roc-w', level: 'weekly', title: 'Sprint — Private Company Incorporation (2 new clients)', parent: 'roc-m', desc: P_('SPICe+ filing for two new incorporations.'), due: 3, dept: D.ROC, status: 'active', by: P.kunal, assignees: [P.riya, P.devansh], progress: 55,
    items: [ { label: 'Daily incorporation progress', rec: 'weekdays', report: true,
      reports: [ { by: P.riya, on: -2, complete: true, body: P_('SPICe+ Part A approved for both companies; Part B being prepared.'),
        reviews: [{ by: P.kunal, stars: 4, comment: 'Good pace. Confirm DSC of all subscribers before submitting Part B.' }] },
        { by: P.devansh, on: -1, body: P_('Drafted MOA/AOA for both companies as per the objects shared by clients.'),
          reviews: [{ by: P.riya, stars: 4, comment: 'Well drafted — just tighten the ancillary objects clause.' }] } ] } ] },
  { key: 'roc-overdue', level: 'weekly', title: 'Charge Registration — Working Capital Loan', desc: P_('Overdue — CHG-1 filing window closing.'), due: -2, dept: D.ROC, status: 'active', by: DHARMESH, assignees: [P.kunal], progress: 60,
    items: [ { label: 'File CHG-1 for the bank charge', rec: 'once', report: true,
      reports: [ { by: P.kunal, on: -4, body: P_('Charge documents ready; awaiting the bank’s sanction letter copy for the annexure.'),
        reviews: [{ by: DHARMESH, stars: 3, comment: 'Call the bank RM directly — we cannot miss the 30-day condonation-free window.' }] } ] } ] },
  { key: 'roc-achieved', level: 'weekly', title: 'Compounding Application — Delayed AGM', desc: P_('Resolved — compounding order received, no further penalty.'), due: -20, dept: D.ROC, status: 'achieved', by: RAJESH, assignees: [P.kunal], progress: 100,
    items: [ { label: 'File & follow up compounding application', rec: 'once', report: true,
      reports: [ { by: P.kunal, on: -22, complete: true, body: P_('RD passed the compounding order with minimum fine; matter closed.'),
        reviews: [{ by: RAJESH, stars: 5, comment: 'Clean resolution — client is relieved. ⭐' }] } ] } ] },

  // ═══ Accounts & Bookkeeping ═══
  { key: 'acct-y', level: 'yearly', title: 'Bookkeeping Turnaround Under 5 Days', desc: P_('Every retainer client’s monthly books closed within 5 working days of month-end.'), due: 230, dept: D.ACCT, status: 'active', by: DHARMESH, assignees: [P.pooja], progress: 40 },
  { key: 'acct-m', level: 'monthly', title: 'July — Monthly Book Closure (18 Clients)', parent: 'acct-y', desc: P_('Close books, reconcile banks, and generate MIS for all retainer clients.'), due: 8, dept: D.ACCT, status: 'active', by: P.pooja, assignees: [P.manish, P.tanvi, P.arjun], progress: 65,
    items: [
      { label: 'Daily bookkeeping progress', desc: P_('Clients closed, reconciliation status, exceptions.'), rec: 'daily', report: true,
        reports: [
          { by: P.manish, on: -1, complete: true, body: P_('Closed books for 5 clients; all bank reconciliations tied out.'),
            reviews: [{ by: P.pooja, stars: 5, comment: 'Perfect close rate today. ⭐' }] },
          { by: P.tanvi, on: -1, body: P_('4 clients closed; one has an unreconciled ₹32,000 credit card difference.'),
            reviews: [{ by: P.manish, stars: 4, comment: 'Good catch — check for a duplicate entry in the CC statement import.' }] },
          { by: P.arjun, on: -2, body: P_('Posted vendor bills for 3 clients; GST input tagging done.'),
            reviews: [{ by: P.pooja, stars: 4, comment: 'Clean tagging. Keep at this pace to hit the 5-day target.' }] },
        ] },
      { label: 'Generate monthly MIS pack', rec: 'monthly', report: true,
        reports: [ { by: P.manish, on: 0, body: P_('MIS packs generated for 10 clients so far; rest in progress.'),
          reviews: [{ by: P.pooja, stars: 4, comment: 'On track — send the completed ones to clients today, don’t wait for all 18.' }] } ] },
    ] },
  { key: 'acct-w', level: 'weekly', title: 'Sprint — Payroll Processing (Client: Nimbus Retail)', parent: 'acct-m', desc: P_('Process July payroll for a 40-employee client including PF/ESI.'), due: 2, dept: D.ACCT, status: 'active', by: P.pooja, assignees: [P.tanvi], progress: 70,
    items: [ { label: 'Daily payroll checklist', rec: 'weekdays', report: true,
      reports: [ { by: P.tanvi, on: -1, complete: true, body: P_('Payroll computed for all 40 employees; PF/ESI challans generated.'),
        reviews: [{ by: P.pooja, stars: 5, comment: 'Right on time before the 15th. ⭐' }] } ] } ] },
  { key: 'acct-overdue', level: 'daily', title: 'Fix Vendor Ledger Mismatch — Kohli Textiles', desc: P_('Overdue reconciliation causing delayed vendor payments.'), due: -2, dept: D.ACCT, status: 'active', by: DHARMESH, assignees: [P.arjun], progress: 50,
    items: [ { label: 'Reconcile vendor ledger', rec: 'daily', report: true,
      reports: [ { by: P.arjun, on: -3, body: P_('Found 3 duplicate bill entries causing the mismatch; correcting now.'),
        reviews: [{ by: P.pooja, stars: 3, comment: 'Good diagnosis — finish the correction today, the vendor is chasing payment.' }] } ] } ] },
  { key: 'acct-achieved', level: 'monthly', title: 'Migrate 5 Clients to Cloud Accounting', desc: P_('Completed — all 5 clients live on cloud books with bank feeds.'), due: -18, dept: D.ACCT, status: 'achieved', by: P.pooja, assignees: [P.manish, P.tanvi], progress: 100,
    items: [ { label: 'Migrate & train clients on cloud accounting', rec: 'once', report: true,
      reports: [ { by: P.manish, on: -20, complete: true, body: P_('All 5 clients migrated with bank feeds connected; training sessions completed.'),
        reviews: [{ by: DHARMESH, stars: 5, comment: 'This will save real hours every month going forward. ⭐' }] } ] } ] },

  // ═══ Internal Audit & Risk Advisory ═══
  { key: 'risk-m', level: 'monthly', title: 'Internal Financial Controls Review — Q1', desc: P_('IFC testing for 3 corporate clients under the Companies Act.'), due: 12, dept: D.RISK, status: 'active', by: RAJESH, assignees: [P.rahul, P.divya], progress: 45,
    items: [ { label: 'Weekly control-testing report', rec: 'weekly', report: true,
      reports: [ { by: P.rahul, on: -3, complete: true, body: P_('Tested procurement and payroll controls for Client A — 2 design gaps found.'),
        reviews: [{ by: RAJESH, stars: 4, comment: 'Good depth on procurement — write these up as formal observations for the audit committee.' }] },
        { by: P.divya, on: -3, body: P_('Walkthrough of revenue-recognition controls for Client B done; no material gaps yet.'),
          reviews: [{ by: P.rahul, stars: 4, comment: 'Solid walkthrough. Sample-test 15 transactions next to confirm operating effectiveness.' }] } ] } ] },
  { key: 'risk-w', level: 'weekly', title: 'Sprint — Fraud Risk Assessment (Client: Orion Logistics)', parent: 'risk-m', desc: P_('Risk-map key fraud scenarios in the procure-to-pay cycle.'), due: 4, dept: D.RISK, status: 'active', by: P.rahul, assignees: [P.aryan], progress: 35,
    items: [ { label: 'Daily risk-mapping notes', rec: 'weekdays', report: true,
      reports: [ { by: P.aryan, on: -1, body: P_('Mapped 8 fraud scenarios in vendor onboarding and payment approval.'),
        reviews: [{ by: P.divya, stars: 4, comment: 'Good first pass — add likelihood/impact scoring to each scenario.' }] } ] } ] },
  { key: 'risk-notmet', level: 'monthly', title: 'June — Whistleblower Policy Rollout', desc: P_('Missed — policy drafted but board sign-off pending, closed as not met.'), due: -10, dept: D.RISK, status: 'not_met', by: DHARMESH, assignees: [P.divya], progress: 70,
    items: [ { label: 'Draft & roll out whistleblower policy', rec: 'once', report: true,
      reports: [ { by: P.divya, on: -15, body: P_('Policy drafted and circulated; board sign-off didn’t happen before month-end.'),
        reviews: [{ by: DHARMESH, stars: 3, comment: 'The delay was on our side, not yours — re-raise this at the next board meeting.' }] } ] } ] },
  { key: 'risk-achieved', level: 'weekly', title: 'Physical Verification of Fixed Assets — Client Warehouse', desc: P_('Completed — 100% assets tagged and verified.'), due: -14, dept: D.RISK, status: 'achieved', by: P.rahul, assignees: [P.divya, P.aryan], progress: 100,
    items: [ { label: 'Complete physical verification & tagging', rec: 'once', report: true,
      reports: [ { by: P.aryan, on: -16, complete: true, body: P_('All 340 assets physically verified and barcode-tagged; 3 assets found missing, flagged to client.'),
        reviews: [{ by: P.rahul, stars: 5, comment: 'Thorough work for a first assignment — great attention to detail. ⭐' }] } ] } ] },

  // ═══ Client Advisory & Admin ═══
  { key: 'admin-m', level: 'monthly', title: 'Client Onboarding SLA — Under 3 Days', desc: P_('Every new client fully onboarded (KYC, engagement letter, portal access) within 3 working days.'), due: 15, dept: D.ADMIN, status: 'active', by: RAJESH, assignees: [P.simran], progress: 50,
    items: [ { label: 'Weekly onboarding tracker update', rec: 'weekly', report: true,
      reports: [ { by: P.simran, on: -3, complete: true, body: P_('Onboarded 4 new clients this week; average turnaround 2.1 days.'),
        reviews: [{ by: RAJESH, stars: 5, comment: 'Ahead of the SLA — great client experience. ⭐' }] } ] } ] },
  { key: 'admin-w', level: 'weekly', title: 'Front Office — Document Courier & Client Calls', parent: 'admin-m', desc: P_('Handle daily client walk-ins, courier dispatch, and appointment scheduling.'), due: 2, dept: D.ADMIN, status: 'active', by: P.simran, assignees: [P.farhan], progress: 60,
    items: [ { label: 'Daily front-office log', rec: 'weekdays', report: true,
      reports: [ { by: P.farhan, on: -1, complete: true, body: P_('Handled 12 client calls, dispatched 5 courier packets, scheduled 3 partner meetings.'),
        reviews: [{ by: P.simran, stars: 4, comment: 'Smooth day — remember to confirm courier delivery receipts by evening.' }] } ] } ] },
  { key: 'admin-inactive', level: 'monthly', title: 'Explore Client Portal Software Upgrade', desc: P_('Inactive — pending budget approval.'), due: 45, dept: D.ADMIN, status: 'inactive', by: DHARMESH, assignees: [P.simran], progress: 0,
    items: [ { label: 'Shortlist 3 portal vendors', rec: 'once' } ] },

  // ═══ Firm-wide (Leadership) — assignment only, spans departments ═══
  { key: 'firm-y', level: 'yearly', title: 'Firm-Wide Quality Control Review 2026', desc: P_('Annual QC review across every department ahead of the ICAI peer review cycle.'), due: 250, dept: D.AUDIT, depts: [D.AUDIT, D.DTAX, D.GST, D.ROC, D.ACCT, D.RISK], status: 'active', by: RAJESH, assignees: [P.priya, P.vikram, P.ananya, P.kunal, P.pooja, P.rahul], progress: 15 },
];

const manifest = { goalIds: [] as string[], createdAt: new Date().toISOString() };

async function ins<T extends Record<string, unknown>>(table: string, row: T): Promise<string> {
  const { data, error } = await admin.from(table).insert(row).select('id').single();
  if (error) throw new Error(`insert ${table}: ${error.message} :: ${JSON.stringify(row).slice(0, 200)}`);
  return (data as { id: string }).id;
}
async function insNoId(table: string, row: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from(table).insert(row);
  if (error) throw new Error(`insert ${table}: ${error.message}`);
}

async function main() {
  const goalIdByKey: Record<string, string> = {};
  const pending = [...GOALS];
  let guard = 0;
  while (pending.length && guard++ < 100) {
    const g = pending.shift()!;
    if (g.parent && !goalIdByKey[g.parent]) { pending.push(g); continue; }
    const goalId = await ins('goals', {
      level: g.level,
      title: g.title,
      description: g.desc ?? '',
      due_date: g.due === null ? null : iso(g.due),
      department: g.dept,
      departments: g.depts ?? [g.dept],
      status: g.status,
      progress: 0,
      sort_order: 0,
      parent_id: g.parent ? goalIdByKey[g.parent] : null,
      created_by: g.by,
      created_at: ts(g.due != null && g.due < 0 ? g.due - 2 : -7, 9),
    });
    goalIdByKey[g.key] = goalId;
    manifest.goalIds.push(goalId);

    for (const uid of g.assignees) {
      await insNoId('goal_assignees', {
        goal_id: goalId, user_id: uid, assigned_by: g.by,
        assigned_at: ts(g.due != null && g.due < 0 ? g.due - 2 : -7, 9),
      });
    }

    let sort = 0;
    for (const it of g.items ?? []) {
      const itemId = await ins('goal_checklist_items', {
        goal_id: goalId, label: it.label, description: it.desc ?? '',
        recurrence: it.rec, recur_days: it.recurDays ?? [],
        report_required: !!it.report, sort_order: sort++, is_done: false,
      });
      for (const d of it.done ?? []) {
        await insNoId('goal_checklist_completions', { item_id: itemId, user_id: d.by, done_at: ts(d.on) });
      }
      for (const r of it.reports ?? []) {
        const reportId = await ins('goal_work_reports', {
          item_id: itemId, user_id: r.by, report_date: iso(r.on), body: r.body,
          created_at: ts(r.on), updated_at: ts(r.on),
        });
        if (r.complete) {
          await insNoId('goal_checklist_completions', { item_id: itemId, user_id: r.by, done_at: ts(r.on) });
        }
        for (const rv of r.reviews ?? []) {
          await insNoId('goal_work_report_reviews', {
            report_id: reportId, reviewer_id: rv.by, stars: rv.stars, comment: rv.comment,
            created_at: ts(r.on + (rv.after ?? 1)), updated_at: ts(r.on + (rv.after ?? 1)),
          });
        }
      }
    }
    await admin.from('goals').update({ progress: g.progress }).eq('id', goalId);
  }
  if (pending.length) throw new Error('Unresolved parents: ' + pending.map((p) => p.key).join(', '));

  writeFileSync(join(process.cwd(), 'scripts', '_goals_manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n✅ Goals seed complete. Goals created: ${manifest.goalIds.length}`);
}
main().catch((e) => { console.error('\n❌', e.message || e); process.exit(1); });
