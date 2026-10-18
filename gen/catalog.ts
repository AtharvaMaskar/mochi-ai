// Fixed vocabulary for the fictional broker E Corp Securities. Every name here is invented.
export const BROKER = 'E Corp Securities';

export const TEAMS = ['onboarding', 'payments', 'trading', 'platform'] as const;
export const AREA_TEAM = { login: 'onboarding', kyc: 'onboarding', funds: 'payments', charges: 'payments', orders: 'trading', app: 'platform' } as const;
export type Area = keyof typeof AREA_TEAM;

export const AGENTS = [
  { id: 'A-1', name: 'Ritika Venkatesan', team: 'onboarding' },
  { id: 'A-2', name: 'Farhan Qadri', team: 'onboarding' },
  { id: 'A-3', name: 'Neha Kulkarni', team: 'payments' },
  { id: 'A-4', name: 'Arjun Pillai', team: 'payments' },
  { id: 'A-5', name: 'Kabir Rao', team: 'trading' },
  { id: 'A-6', name: 'Zoya Contractor', team: 'platform' },
];

export const CITIES = ['Mumbai', 'Delhi', 'Bengaluru', 'Pune', 'Chennai', 'Hyderabad', 'Kolkata', 'Ahmedabad'];
export const FIRST = ['Aarav', 'Vihaan', 'Ishaan', 'Reyansh', 'Advait', 'Kian', 'Dhruv', 'Kabir', 'Rohan', 'Siddharth', 'Tanvi', 'Ananya', 'Diya', 'Ira', 'Kavya', 'Meera', 'Nisha', 'Pooja', 'Riya', 'Saanvi', 'Aditi', 'Lakshmi', 'Gautam', 'Harish', 'Imran', 'Javed', 'Nikhil', 'Pranav', 'Yash', 'Zara'];
export const LAST = ['Iyer', 'Menon', 'Deshpande', 'Gokhale', 'Bhatt', 'Chawla', 'Dutta', 'Ganguly', 'Hegde', 'Joshi', 'Kamath', 'Lobo', 'Mathur', 'Nair', 'Oberoi', 'Patil', 'Rangan', 'Saxena', 'Talwar', 'Upadhyay', 'Vora', 'Wadia', 'Yadav', 'Zaveri', 'Shenoy'];

type IssueDef = {
  name: string; area: Area; subjects: string[]; bodies: string[]; hinglish: string;
  kb: { title: string; steps: string[] }; fix: { kind: 'fix' | 'info'; summary: string };
};

// 3 issues per area, in id order I-01..I-18.
export const ISSUES: IssueDef[] = [
  { name: 'OTP not received at login', area: 'login', subjects: ['OTP not coming', 'Cannot log in, no OTP'],
    bodies: ['I am trying to log in but the SMS OTP never arrives.', 'Login OTP has not come for 20 minutes, tried resend three times.'],
    hinglish: 'Login ke time OTP aa hi nahi raha, teen baar resend kiya.',
    kb: { title: 'Login OTP not delivered', steps: ['Confirm registered mobile number', 'Check DND status with the telecom operator', 'Trigger OTP resend from the admin console'] },
    fix: { kind: 'fix', summary: 'Re-triggered OTP after correcting registered mobile' } },
  { name: 'account locked after failed PIN attempts', area: 'login', subjects: ['Account locked', 'PIN blocked'],
    bodies: ['My account got locked after I entered the wrong PIN.', 'It says too many attempts and the account is blocked.'],
    hinglish: 'Galat PIN daalne ke baad account lock ho gaya, please unlock karo.',
    kb: { title: 'Unlocking an account after PIN lockout', steps: ['Verify identity with date of birth', 'Unlock from the admin console', 'Ask the customer to reset PIN'] },
    fix: { kind: 'fix', summary: 'Unlocked account and sent PIN reset link' } },
  { name: 'TOTP setup fails', area: 'login', subjects: ['Authenticator setup failing', 'TOTP code invalid'],
    bodies: ['The authenticator app code is always rejected during setup.', 'TOTP setup says invalid code even though the time is correct.'],
    hinglish: 'Authenticator ka code har baar invalid bol raha hai.',
    kb: { title: 'TOTP enrolment errors', steps: ['Check device time sync', 'Reset TOTP secret', 'Re-scan the QR code'] },
    fix: { kind: 'fix', summary: 'Reset TOTP secret and re-enrolled device' } },
  { name: 'KYC stuck in verification', area: 'kyc', subjects: ['KYC pending for days', 'Account not activated'],
    bodies: ['My KYC has shown under verification for many days.', 'Documents uploaded last week, account still not active.'],
    hinglish: 'KYC abhi tak verification mein atka hua hai, account kab active hoga?',
    kb: { title: 'KYC verification timelines', steps: ['Check document status in the KYC queue', 'Escalate to the verification desk if older than SLA', 'Inform customer of the expected time'] },
    fix: { kind: 'fix', summary: 'Pushed KYC file from the verification queue' } },
  { name: 'e-sign OTP failing', area: 'kyc', subjects: ['e-sign not working', 'Cannot complete e-sign'],
    bodies: ['The e-sign step fails right after I enter the OTP.', 'e-sign page keeps erroring out at the last step.'],
    hinglish: 'e-sign ka OTP daalte hi error aa jata hai.',
    kb: { title: 'e-sign failures', steps: ['Confirm mobile linked to the ID', 'Retry e-sign after 15 minutes', 'Offer the courier form as fallback'] },
    fix: { kind: 'fix', summary: 'Restarted e-sign session after ID mobile check' } },
  { name: 'bank proof rejected', area: 'kyc', subjects: ['Bank proof rejected', 'Cancelled cheque not accepted'],
    bodies: ['My bank proof was rejected without any reason.', 'Uploaded cancelled cheque twice, both rejected.'],
    hinglish: 'Bank proof do baar reject ho gaya, reason bhi nahi bataya.',
    kb: { title: 'Accepted bank proof documents', steps: ['List accepted documents', 'Check name match with the bank account', 'Request a fresh upload'] },
    fix: { kind: 'info', summary: 'Explained accepted bank proof formats' } },
  { name: 'payment debited, funds not credited', area: 'funds', subjects: ['Money debited, not in account', 'Fund transfer missing'],
    bodies: ['Money was debited from my bank but the trading balance did not increase.', 'I added funds an hour ago, bank shows debit, ledger shows nothing.'],
    hinglish: 'Paisa bank se kat gaya par trading account mein nahi aaya.',
    kb: { title: 'Funds debited but not credited', steps: ['Collect bank reference number', 'Match against the payment gateway report', 'Credit manually or confirm auto-reversal'] },
    fix: { kind: 'fix', summary: 'Matched gateway reference and credited funds' } },
  { name: 'UPI mandate failure', area: 'funds', subjects: ['UPI mandate failing', 'Cannot add money via UPI'],
    bodies: ['UPI mandate request fails right after approval in my bank app.', 'Every UPI add-funds attempt fails since the update.'],
    hinglish: 'Update ke baad UPI se paise add hi nahi ho rahe.',
    kb: { title: 'UPI mandate errors', steps: ['Check the mandate status code', 'Ask customer to revoke and recreate the mandate', 'Fall back to net banking'] },
    fix: { kind: 'fix', summary: 'Recreated UPI mandate after revoking the stale one' } },
  { name: 'withdrawal delayed', area: 'funds', subjects: ['Withdrawal not received', 'Payout delayed'],
    bodies: ['I requested a withdrawal two days ago and have not received it.', 'Payout request is still processing.'],
    hinglish: 'Withdrawal ka paisa do din se nahi aaya.',
    kb: { title: 'Withdrawal processing times', steps: ['Check payout batch status', 'Confirm bank account is verified', 'Share the expected credit date'] },
    fix: { kind: 'fix', summary: 'Released payout from held batch' } },
  { name: 'order rejected for margin shortfall', area: 'orders', subjects: ['Order rejected for margin', 'Margin shortfall error'],
    bodies: ['My order got rejected for margin shortfall even though I have balance.', 'Order rejected, it says insufficient margin which is wrong.'],
    hinglish: 'Balance hone ke baad bhi order margin ki wajah se reject ho gaya.',
    kb: { title: 'Margin shortfall rejections', steps: ['Compare available margin with the order value', 'Check for blocked collateral', 'Explain the peak margin rule'] },
    fix: { kind: 'info', summary: 'Explained margin calculation and blocked collateral' } },
  { name: 'order stuck in pending', area: 'orders', subjects: ['Order pending forever', 'Order not executed'],
    bodies: ['My order has been in pending state for an hour.', 'Placed a buy order, it is still pending and I cannot cancel it.'],
    hinglish: 'Order ek ghante se pending mein atka hai, cancel bhi nahi ho raha.',
    kb: { title: 'Orders stuck in pending', steps: ['Check the order router status', 'Cancel from the dealer terminal', 'Confirm with the customer'] },
    fix: { kind: 'fix', summary: 'Cancelled stuck order from dealer terminal' } },
  { name: 'stop-loss not triggered', area: 'orders', subjects: ['Stop-loss did not trigger', 'SL order missed'],
    bodies: ['Price crossed my stop-loss but the order never triggered.', 'My SL order did not execute and I lost money.'],
    hinglish: 'Stop-loss hit hua par order trigger nahi hua.',
    kb: { title: 'Stop-loss trigger rules', steps: ['Pull the trigger log', 'Compare with the price feed', 'Explain trigger price vs limit price'] },
    fix: { kind: 'info', summary: 'Explained trigger vs limit price from the log' } },
  { name: 'brokerage charged twice', area: 'charges', subjects: ['Double brokerage', 'Charged twice for one trade'],
    bodies: ['I was charged brokerage twice for the same trade.', 'Contract note shows double brokerage.'],
    hinglish: 'Ek hi trade ka brokerage do baar kat gaya.',
    kb: { title: 'Duplicate brokerage reversals', steps: ['Check the contract note', 'Raise a reversal request', 'Confirm the refund date'] },
    fix: { kind: 'fix', summary: 'Reversed duplicate brokerage' } },
  { name: 'DP charges not explained', area: 'charges', subjects: ['What are DP charges', 'Unknown DP charge'],
    bodies: ['There is a DP charge in my ledger I do not understand.', 'Why was I charged DP charges when I only sold once?'],
    hinglish: 'Ledger mein DP charge kyun laga hai samajh nahi aaya.',
    kb: { title: 'DP charges explained', steps: ['Explain per-scrip sell charge', 'Show the ledger entry', 'Link the tariff sheet'] },
    fix: { kind: 'info', summary: 'Explained DP charge per scrip sold' } },
  { name: 'AMC deducted unexpectedly', area: 'charges', subjects: ['AMC deducted', 'Annual charge without notice'],
    bodies: ['An annual maintenance charge was deducted without notice.', 'Why is AMC charged when my plan says free?'],
    hinglish: 'Bina bataye AMC kat gaya, plan mein free tha.',
    kb: { title: 'Annual maintenance charges', steps: ['Check plan AMC terms', 'Reverse if the plan waives AMC', 'Explain the billing cycle'] },
    fix: { kind: 'fix', summary: 'Reversed AMC for a waived plan' } },
  { name: 'app crashes on launch', area: 'app', subjects: ['App crashing', 'App closes on open'],
    bodies: ['The app crashes as soon as I open it.', 'App closes on the splash screen every time.'],
    hinglish: 'App kholte hi band ho jata hai.',
    kb: { title: 'App crash on launch', steps: ['Collect device model and app version', 'Check the crash dashboard', 'Ship fix in the next build'] },
    fix: { kind: 'fix', summary: 'Patched build pushed after crash log review' } },
  { name: 'charts not loading', area: 'app', subjects: ['Charts blank', 'Chart not loading'],
    bodies: ['Charts are blank since the latest update.', 'The chart screen keeps spinning and never loads.'],
    hinglish: 'Update ke baad chart load hi nahi ho raha.',
    kb: { title: 'Charts not loading', steps: ['Check chart service status', 'Clear chart cache', 'Switch chart provider setting'] },
    fix: { kind: 'fix', summary: 'Cleared chart cache and switched provider setting' } },
  { name: 'portfolio shows zero holdings', area: 'app', subjects: ['Holdings showing zero', 'Portfolio empty'],
    bodies: ['My portfolio shows zero holdings but I own shares.', 'Holdings page is empty after the update.'],
    hinglish: 'Portfolio mein holdings zero dikha raha hai, shares toh hain.',
    kb: { title: 'Holdings display issues', steps: ['Verify holdings in the depository statement', 'Force a holdings resync', 'Ask customer to re-login'] },
    fix: { kind: 'fix', summary: 'Forced holdings resync' } },
];

// Second KB for seven issues (FAQ-style, kind info). Keys are issue indexes.
export const SECOND_KB: Record<number, { title: string; steps: string[]; summary: string }> = {
  1: { title: 'PIN policy FAQ', steps: ['Explain the five-attempt rule', 'Explain the cool-off period'], summary: 'Shared PIN policy FAQ' },
  4: { title: 'e-sign FAQ', steps: ['List e-sign prerequisites', 'Explain courier fallback'], summary: 'Shared e-sign FAQ' },
  8: { title: 'Payout schedule FAQ', steps: ['Explain payout cut-off times', 'Explain bank holidays'], summary: 'Shared payout schedule' },
  9: { title: 'Margin FAQ', steps: ['Explain peak margin', 'Explain collateral haircut'], summary: 'Shared margin FAQ' },
  11: { title: 'Order types FAQ', steps: ['Explain SL vs SL-M', 'Explain trigger price'], summary: 'Shared order types FAQ' },
  13: { title: 'Charges FAQ', steps: ['List all statutory charges', 'Link the tariff sheet'], summary: 'Shared charges FAQ' },
  14: { title: 'Plan billing FAQ', steps: ['Explain plan billing cycle', 'Explain AMC waivers'], summary: 'Shared plan billing FAQ' },
};

// Undocumented workarounds: used widely, written in no KB.
export const WORKAROUNDS: Record<number, string> = {
  0: 'Workaround: switch the customer to email OTP from the admin console',
  15: 'Workaround: ask the customer to clear app data and reinstall',
};

export const NOISE_PRE = ['', '', 'Hi team, ', 'Hello, ', 'Dear support, ', 'Namaste, '];
export const NOISE_POST = ['', '', ' Please help.', ' This is urgent.', ' Please check asap.', ' Waiting for a reply.', ' Kindly resolve.'];

export const RELEASE_NOTES = [
  'Login flow refresh',
  'Authenticator enrolment rework',
  'New payments gateway and order router',
  'KYC document checks tightened',
  'KYC vendor queue moved; funds reconciliation batch moved to T+1',
  'Charting engine and holdings service rewrite',
  'Plan billing changes',
  'Stability fixes',
];
