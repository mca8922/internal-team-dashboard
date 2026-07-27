'use client';

// Guided onboarding tour. Instead of one static card, each step shines a
// spotlight on a real part of the dashboard and explains it in plain words.
// The tour drives its own navigation, so it can walk a new member across
// several pages. It shows once on the first visit (tracked in localStorage)
// and can be replayed from Settings by dispatching a `restruc:open-tour`
// window event.
import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Icon, type IconName } from './Icon';
import { Button } from './ui';
import { useToast } from './Toast';
import { markTourSeen } from '@/lib/actions';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

// Breathing room between the highlighted element and the spotlight ring.
const SPOT_PAD = 6;

interface TourStep {
  icon: IconName;
  title: string;
  intro?: string;
  points?: string[];
  outro?: string;
  // The page this step belongs to. The tour navigates here automatically.
  route?: string;
  // CSS selector of the element to spotlight. Omit for a centered card.
  selector?: string;
  boardOnly?: boolean;
  // Shown to department managers only (not the Board, not plain members) —
  // for steps whose content differs by leadership scope (e.g. the Team page
  // is a full org roster for the Board but a department-scoped status view
  // for a manager; see ManagerTeamPage in team/page.tsx).
  managerOnly?: boolean;
  // Only shown while this feature flag is on — see PHASE.md / featureFlags.ts.
  // The step's route (e.g. `/log`) redirects away entirely while its flag is
  // off, so skipping the step is required, not just tidy.
  flag?: keyof typeof FEATURE_FLAGS;
}

const STEPS: TourStep[] = [
  {
    icon: 'sparkles',
    title: 'Welcome to your Team Dashboard',
    intro:
      'This is the home base for your work at Mahesh Chandra & Associates. In the next minute we will point out each part of the dashboard so you know exactly where everything lives. Use Next to move along, or Skip if you would rather explore on your own.',
    route: '/dashboard',
  },
  {
    icon: 'sidebar',
    title: 'Your sidebar menu',
    intro:
      'This menu on the left takes you to every part of the dashboard. The page you are currently on stays highlighted, so you always know where you are.',
    route: '/dashboard',
    selector: '[data-tour="sidebar"]',
  },
  {
    icon: 'clock',
    title: 'Punch in to start your day',
    intro:
      'This card is where you start and stop your workday. Press Punch in when you begin. The card then keeps a running total of your hours against your daily target.',
    route: '/dashboard',
    selector: '[data-tour="punch-widget"]',
  },
  {
    icon: 'target',
    title: 'Your goals for the week',
    intro:
      'This card lists what you are working toward this week. Each bar fills up as the work gets done, so your priorities are always in plain sight.',
    route: '/dashboard',
    selector: '[data-tour="goals-card"]',
  },
  {
    icon: 'edit',
    title: 'Set the tone of your day',
    flag: 'dailyLog',
    intro:
      'Every Daily Log starts here. Pick a mood, rate your energy, and add tags to label what the day was about, such as a client or a project.',
    route: '/log',
    selector: '[data-tour="log-meta"]',
  },
  {
    icon: 'edit',
    title: 'Write your log in blocks',
    flag: 'dailyLog',
    intro: 'This is your writing space. A few things make it easy to use:',
    points: [
      'Every log opens with two questions for you to answer in your own words.',
      'Type a slash to add headings, lists, checklists, and more.',
      'Hover over any line to move it or delete it.',
    ],
    route: '/log',
    selector: '[data-tour="log-editor"]',
  },
  {
    icon: 'target',
    title: 'The Goals page',
    intro:
      'Open Goals from the sidebar to see the big picture: the company’s yearly goals broken down into monthly, weekly and daily work.',
    points: [
      'Most goals carry a checklist you tick off as you go, and your progress updates on its own.',
      'Finish your last item due for the day and you get a little celebration. 🎉',
      'Descriptions can be richly formatted (bold, lists and more) so “done” is always clear.',
    ],
    route: '/dashboard',
    selector: '[data-tour="nav-goals"]',
  },
  {
    icon: 'target',
    title: 'Managing goals across the team',
    boardOnly: true,
    intro:
      'As a board member, the Goals page is your command centre for execution across every department.',
    points: [
      'Search any goal by title or description, and filter by department, status or what’s overdue.',
      'A health strip up top shows totals, active, overdue and completed at a glance. Click any to filter.',
      'Use the ⋮ menu on a card to change a goal’s status or reassign members on the spot, or Duplicate it to hand it to someone else.',
      'A teammate on approved leave is marked “On leave” and left out of that day’s progress automatically.',
    ],
    route: '/dashboard',
    selector: '[data-tour="nav-goals"]',
  },
  {
    icon: 'target',
    title: 'Managing goals for your department',
    managerOnly: true,
    intro:
      'As a department manager, you get the same execution tools as the Board — scoped to your own department.',
    points: [
      'Search and filter your department’s goals by status or what’s overdue.',
      'Use the ⋮ menu on a card to change a goal’s status or reassign it to someone on your team.',
      'A teammate on approved leave is marked “On leave” and left out of that day’s progress automatically.',
    ],
    route: '/dashboard',
    selector: '[data-tour="nav-goals"]',
  },
  {
    icon: 'users',
    title: 'The Team page',
    boardOnly: true,
    intro:
      'As a board member you manage everyone from here. Add new members, edit their details, set their daily hours, and offboard anyone who leaves.',
    route: '/dashboard',
    selector: '[data-tour="nav-team"]',
  },
  {
    icon: 'users',
    title: 'Your department’s Team page',
    managerOnly: true,
    intro:
      'As a department manager, this page shows your team at a glance: who is punched in, on leave, or running short on hours today, plus their weekly totals.',
    route: '/dashboard',
    selector: '[data-tour="nav-team"]',
  },
  {
    icon: 'chart',
    title: 'The Analytics page',
    intro:
      'Analytics turns your punches and logs into clear trends, so you can see how your hours and habits are tracking over time.',
    route: '/dashboard',
    selector: '[data-tour="nav-analytics"]',
  },
  {
    icon: 'plane',
    title: 'The Leaves page',
    intro:
      'Need time off? Open Leaves, pick your dates, and send the request. A board member reviews it, and you will see when it is approved.',
    route: '/dashboard',
    selector: '[data-tour="nav-leaves"]',
  },
  {
    icon: 'bell',
    title: 'Your notifications',
    intro:
      'This bell shows what needs your attention, like a workday you have not logged yet. A number on the bell means there are new items to check.',
    route: '/dashboard',
    selector: '[data-tour="topbar-bell"]',
  },
  {
    icon: 'sun',
    title: 'Switch the look',
    intro:
      'Use this button to switch between a Light theme, a Dark theme, or one that follows your device. Pick whatever is easiest on your eyes.',
    route: '/dashboard',
    selector: '[data-tour="topbar-theme"]',
  },
  {
    icon: 'settings',
    title: 'Settings and this tour',
    intro:
      'In Settings you can add a profile photo and update your details. You can also replay this whole tour from there any time you need a refresher.',
    route: '/dashboard',
    selector: '[data-tour="nav-settings"]',
  },
  {
    icon: 'check',
    title: 'You are all set',
    intro:
      'That is the whole dashboard. A simple daily habit goes a long way: punch in, do your work, write your log, and punch out.',
    outro: 'Welcome aboard. You can replay this tour from Settings whenever you like.',
    route: '/dashboard',
  },
];

// Place the explanation card on whichever side of the spotlight has room
// (below, above, right, then left), and always keep it inside the viewport.
function placeTooltip(target: DOMRect, tw: number, th: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const M = 14; // viewport margin
  const GAP = 14; // gap between the spotlight and the card
  const centerX = target.left + target.width / 2 - tw / 2;
  const centerY = target.top + target.height / 2 - th / 2;

  let top: number;
  let left: number;
  if (target.bottom + GAP + th + M <= vh) {
    top = target.bottom + GAP;
    left = centerX;
  } else if (target.top - GAP - th - M >= 0) {
    top = target.top - GAP - th;
    left = centerX;
  } else if (target.right + GAP + tw + M <= vw) {
    left = target.right + GAP;
    top = centerY;
  } else if (target.left - GAP - tw - M >= 0) {
    left = target.left - GAP - tw;
    top = centerY;
  } else {
    top = (vh - th) / 2;
    left = (vw - tw) / 2;
  }
  // Clamp so the whole card stays on screen, whatever the chosen side.
  top = Math.max(M, Math.min(top, vh - th - M));
  left = Math.max(M, Math.min(left, vw - tw - M));
  return { top, left };
}

export function OnboardingTour({
  isBoard,
  isMgr,
  tourSeen,
}: {
  isBoard: boolean;
  isMgr: boolean;
  tourSeen: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const steps = React.useMemo(
    () =>
      STEPS.filter(
        (s) =>
          (!s.boardOnly || isBoard) &&
          (!s.managerOnly || isMgr) &&
          (!s.flag || FEATURE_FLAGS[s.flag]),
      ),
    [isBoard, isMgr],
  );

  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(0);
  // The highlighted element's viewport box, or null for a centered card.
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  // False while we navigate to a page or wait for the target to render.
  const [ready, setReady] = React.useState(false);
  // The tooltip's resolved viewport position (computed after it is measured).
  const [tipPos, setTipPos] = React.useState<{ top: number; left: number } | null>(null);
  const tipRef = React.useRef<HTMLDivElement>(null);

  const total = steps.length;
  const cur = steps[Math.min(step, total - 1)];

  const finish = React.useCallback(() => {
    // Persist server-side so the tour never shows again on any browser.
    markTourSeen().catch(() => {});
    // When the tour ends, nudge the member to set their own password
    // (board members hand out a temporary one when creating accounts).
    let remindPassword = false;
    try {
      if (localStorage.getItem('restruc:pw-changed') !== '1') {
        localStorage.setItem('restruc:pw-reminder', '1');
        remindPassword = true;
      }
    } catch {
      /* localStorage unavailable */
    }
    setOpen(false);
    setReady(false);
    if (remindPassword) {
      window.dispatchEvent(new Event('restruc:notifs-changed'));
      toast(
        'Welcome aboard. For your account security, set your own password in Settings.',
        'warning',
      );
    }
  }, [toast]);

  // Auto-show on the first visit (server flag), and listen for replay requests.
  React.useEffect(() => {
    if (!tourSeen) {
      setStep(0);
      setOpen(true);
    }
    const onReplay = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener('restruc:open-tour', onReplay);
    return () => window.removeEventListener('restruc:open-tour', onReplay);
  }, [tourSeen]);

  // Resolve the current step: navigate to its page if needed, then find and
  // measure the element to spotlight (retrying while the page renders).
  React.useEffect(() => {
    if (!open) return;
    setReady(false);
    setTipPos(null);

    if (cur.route && pathname !== cur.route) {
      router.push(cur.route);
      return; // this effect re-runs once the route updates
    }
    if (!cur.selector) {
      setRect(null);
      setReady(true);
      return;
    }

    let raf = 0;
    let timer = 0;
    let tries = 0;
    const measure = () => {
      const el = document.querySelector(cur.selector!) as HTMLElement | null;
      if (el) setRect(el.getBoundingClientRect());
    };
    const find = () => {
      const el = document.querySelector(cur.selector!) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        raf = requestAnimationFrame(() => {
          measure();
          setReady(true);
        });
        // Re-measure once page entry animations have settled.
        timer = window.setTimeout(measure, 420);
        return;
      }
      if (tries++ < 80) {
        raf = requestAnimationFrame(find);
      } else {
        // Element never appeared — fall back to a centered card.
        setRect(null);
        setReady(true);
      }
    };
    find();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [open, step, pathname, cur, router]);

  // Keep the spotlight aligned while the page scrolls or resizes.
  React.useEffect(() => {
    if (!open || !cur?.selector) return;
    const repos = () => {
      const el = document.querySelector(cur.selector!) as HTMLElement | null;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener('resize', repos);
    window.addEventListener('scroll', repos, true);
    return () => {
      window.removeEventListener('resize', repos);
      window.removeEventListener('scroll', repos, true);
    };
  }, [open, cur]);

  // Once the tooltip is in the DOM, measure it and place it on whichever
  // side of the spotlight has room, fully inside the viewport.
  React.useEffect(() => {
    if (!open || !ready || !rect) return;
    const el = tipRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setTipPos(placeTooltip(rect, box.width, box.height));
  }, [open, ready, rect, step]);

  // Keyboard: Escape ends the tour, arrows move between steps.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') setStep((s) => Math.min(s + 1, total - 1));
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, finish, total]);

  if (!open) return null;

  const isFirst = step === 0;
  const isLast = step === total - 1;
  const next = () => (isLast ? finish() : setStep((s) => Math.min(s + 1, total - 1)));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const cardBody = (
    <>
      <div className="tour-icon">
        <Icon name={cur.icon} size={24} />
      </div>
      <div className="tour-step-count">
        Step {step + 1} of {total}
      </div>
      <h2 className="tour-title">{cur.title}</h2>
      {cur.intro ? <p className="tour-body">{cur.intro}</p> : null}
      {cur.points ? (
        <ul className="tour-points">
          {cur.points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      ) : null}
      {cur.outro ? <p className="tour-body">{cur.outro}</p> : null}

      <div className="tour-dots">
        {steps.map((_, i) => (
          <button
            key={i}
            type="button"
            className={`tour-dot ${i === step ? 'active' : ''}`}
            aria-label={`Go to step ${i + 1}`}
            onClick={() => setStep(i)}
          />
        ))}
      </div>

      <div className="tour-actions">
        {!isLast ? (
          <Button variant="ghost" size="sm" onClick={finish}>
            Skip tour
          </Button>
        ) : (
          <span />
        )}
        <div className="tour-actions-right">
          {!isFirst ? (
            <Button variant="secondary" size="sm" icon="arrow-left" onClick={back}>
              Back
            </Button>
          ) : null}
          <Button size="sm" onClick={next}>
            {isLast ? 'Get started' : 'Next'}
          </Button>
        </div>
      </div>
    </>
  );

  // Still navigating or locating the target — show a calm dark screen.
  if (!ready) {
    return <div className="tour-blocker dim" aria-hidden="true" />;
  }

  // No element to spotlight: a centered welcome / closing card.
  if (!rect) {
    return (
      <div className="tour-overlay" role="dialog" aria-modal="true" aria-label="Dashboard tour">
        <div className="tour-card" key={step}>
          {cardBody}
        </div>
      </div>
    );
  }

  // Spotlight a real element, with the explanation card clear of it. The
  // card renders hidden for one frame so it can be measured, then the
  // placement effect positions it; this avoids it landing off-screen.
  const tipWidth = Math.min(380, window.innerWidth - 28);
  const tipStyle: React.CSSProperties = tipPos
    ? { width: tipWidth, top: tipPos.top, left: tipPos.left }
    : { width: tipWidth, top: 0, left: 0, visibility: 'hidden' };

  return (
    <>
      <div className="tour-blocker" aria-hidden="true" />
      <div
        className="tour-spot"
        aria-hidden="true"
        style={{
          top: rect.top - SPOT_PAD,
          left: rect.left - SPOT_PAD,
          width: rect.width + SPOT_PAD * 2,
          height: rect.height + SPOT_PAD * 2,
        }}
      />
      <div
        className="tour-tooltip"
        role="dialog"
        aria-modal="true"
        aria-label="Dashboard tour"
        style={tipStyle}
        ref={tipRef}
        key={step}
      >
        {cardBody}
      </div>
    </>
  );
}
