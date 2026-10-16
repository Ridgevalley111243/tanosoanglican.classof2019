import { h, icon } from '../ui.js';
import { state } from '../api.js';
import { GROUP_SHORT, SCHOOL } from '../config.js';

// Terms and privacy, written to match what the system actually does.
// If a rule in the database changes, update the matching line here.
const UPDATED = '16 October 2026';

const sec = (title, ...body) => h('section', { class: 'legal-sec' }, h('h2', {}, title), ...body);
const p = (...t) => h('p', {}, ...t);
const ul = (...items) => h('ul', {}, items.map((i) => h('li', {}, i)));

function page(title, intro, ...sections) {
  const back = state.session ? '#/' : '#/register';
  return h('div', { class: 'legal-page' },
    h('div', { class: 'legal-head' },
      h('a', { class: 'btn ghost small', href: back }, icon('back'), state.session ? 'Back' : 'Back to sign-up'),
      h('div', { class: 'row' },
        h('img', { class: 'brand-logo', src: 'assets/logo.png', alt: '', width: '40', height: '40' }),
        h('div', { class: 'brand-text' }, h('b', {}, `${GROUP_SHORT} Dues`), h('span', {}, SCHOOL)))),
    h('article', { class: 'card legal' },
      h('h1', {}, title),
      h('p', { class: 'muted small' }, `Last updated ${UPDATED}`),
      p(intro),
      ...sections,
      h('p', { class: 'legal-foot' }, 'See also: ',
        h('a', { href: '#/terms' }, 'Terms and conditions'), ' · ', h('a', { href: '#/privacy' }, 'Privacy policy'))));
}

export function terms() {
  return page('Terms and conditions',
    `These terms cover your use of the ${GROUP_SHORT} (${SCHOOL}) dues website. The site is run by the class's elected admins for members of the class. By creating an account you agree to them.`,

    sec('1. Who can use the site',
      ul('The site is for members of the Class of 2019 of Tanoso Anglican J.H.S “A”.',
        'When you sign up you give your real full name, the phone number you use for Mobile Money, and an email address. You receive a member code straight away.',
        'Your account stays “waiting for approval” until an admin confirms you are a member of the class. Until then you cannot see dues or record payments. If you signed up yourself, no dues are added to your record until you are approved.',
        'Admins may refuse or block an account that is not a genuine classmate, gives false details, or misuses the site.')),

    sec('2. Monthly dues',
      ul('Dues are GH₵20 a month unless the admins change the amount. A new amount only applies to months created after the change; months already on your record keep their amount.',
        'Dues for each month are due on the 5th of the following month (for example, November dues are due by 5 December). A month is “overdue” after its due date.',
        'Dues start from November 2026. Every approved member owes every month from that start month, including members who join later.',
        'If you leave the group, an admin can mark you as no longer active. No new months are added after that, but months you already owe stay on your record.')),

    sec('3. Paying',
      ul('You pay by Mobile Money (MTN MoMo, Telecel Cash or AT Money) directly to the number the admins publish on the Pay page. The website never handles money, never connects to your MoMo wallet, and never asks for your MoMo PIN. Do not share your PIN with anyone.',
        'After paying, you record the payment on the site: the network, the transaction ID from your confirmation SMS, the amount, the date and time, and the month or months it covers.',
        'Part payments are not accepted. A payment must cover whole months and the amount must equal the dues for the months you choose. You may also pay ahead for future months.',
        'Each transaction ID can be recorded only once per network.',
        'Recording a false or someone else’s transaction is a serious breach of these terms and the admins may block your account and inform the class.')),

    sec('4. How payments are checked',
      ul('A recorded payment is only a claim until it is checked. Two different admins must each find your transaction on the official Mobile Money statement and approve it before it counts.',
        'No admin can review their own payment.',
        'If an admin needs you to fix something, they send the payment back with a note. You can correct it and send it again; it is then checked afresh by two admins.',
        'A payment is rejected only if two different admins reject it. If you think a rejection is wrong, speak to an admin.',
        'Once two admins approve a payment, the months are marked paid and a receipt with a unique number is issued. Receipts are issued only for confirmed payments.')),

    sec('5. Refunds and mistakes',
      p('Because money moves through Mobile Money and not through the website, the site cannot reverse or refund a payment. If you sent money by mistake or sent too much, contact the admins; any refund is arranged between you and them outside the site.')),

    sec('6. Class funds and spending',
      ul('Only payments confirmed by two admins count as money collected.',
        'Spending from the class fund is recorded by an admin and must be approved by two other admins before it is deducted from the balance.',
        'If the admins choose to show it, members can see the class fund totals (collected, spent and balance). Those totals come from the site’s records; they are not a live reading of any MoMo wallet.')),

    sec('7. Admins',
      ul('Admins are members of the class chosen by the group. Giving someone admin rights, or removing them, needs one admin to propose it and a different admin to confirm it.',
        'Admins can see every member’s details and payment records so they can do this work. They must use them only for running the class dues.',
        'Important actions—approvals, rejections, setting changes, account changes and expenses—are recorded in an audit log that cannot be edited or deleted.')),

    sec('8. Your account',
      ul('Keep your password private. You are responsible for payments recorded from your account.',
        'Reminders and decisions about your payments appear as notices inside the site.',
        'Admins may suspend an account that breaks these terms. A suspended account cannot see dues or record payments.')),

    sec('9. Availability',
      p('The site is provided by volunteers on a best-effort basis. We aim to keep it working and your records accurate, but it may sometimes be unavailable. Your Mobile Money statement and your receipts remain your proof of payment.')),

    sec('10. Changes',
      p('The admins may update these terms when the way the group runs its dues changes. The date at the top shows the latest version. Continuing to use the site after a change means you accept it.')),

    sec('11. Questions',
      p('Speak to any of the class admins (listed in the class WhatsApp group) about anything in these terms.')));
}

export function privacy() {
  return page('Privacy policy',
    `This policy explains what the ${GROUP_SHORT} dues website stores about you, why, who can see it, and what you can ask for. We follow the Data Protection Act, 2012 (Act 843) of Ghana.`,

    sec('1. What we collect',
      ul(h('span', {}, h('b', {}, 'Account details: '), 'your full name, email address and password. Your password is stored only in scrambled (hashed) form by our login provider; admins cannot see it.'),
        h('span', {}, h('b', {}, 'Membership details: '), 'your member code and the phone number you gave.'),
        h('span', {}, h('b', {}, 'Payment records: '), 'for each payment you record—the network, transaction ID, the number you sent from (if you give it), amount, date and time, the months it covers, and its status.'),
        h('span', {}, h('b', {}, 'Review records: '), 'which admins approved, rejected or sent back each payment, and any notes they wrote.'),
        h('span', {}, h('b', {}, 'Dues and receipts: '), 'which months you owe or have paid, and your receipt numbers.'),
        h('span', {}, h('b', {}, 'Notices: '), 'reminders and payment decisions sent to you, and whether you have read them.'),
        h('span', {}, h('b', {}, 'Audit log: '), 'a record of important actions (for example “approved a payment”), with who did it and when.'))),

    sec('2. What we do not collect',
      ul('We never ask for or store your Mobile Money PIN, bank details or ID card numbers.',
        'We do not use advertising, analytics or tracking tools.',
        'We do not sell or share your information with anyone outside the class admins and the services listed below.')),

    sec('3. Why we use it',
      ul('To confirm that you are a member of the class before activating your account.',
        'To work out what each member owes, check payments against the Mobile Money statement, and issue receipts.',
        'To send you reminders before and after due dates, and tell you when a payment is confirmed, rejected or needs fixing.',
        'To keep honest, checkable records of the class fund, including Excel reports the admins download for the group.')),

    sec('4. Who can see it',
      ul(h('span', {}, h('b', {}, 'You '), 'can see your own profile, member code, dues, payments, receipts and notices.'),
        h('span', {}, h('b', {}, 'Other members '), 'cannot see your details or payments. If the admins turn it on, members see only the class fund totals.'),
        h('span', {}, h('b', {}, 'Admins '), 'can see all members’ details, payments, reviews, expenses and the audit log, and can download them as Excel files. They use these only to run the class dues.'),
        'These limits are enforced by the database itself, not just by the website.')),

    sec('5. Where it is stored',
      ul('Records are stored with Supabase, our database and login provider, on servers in London, United Kingdom.',
        'The website itself is hosted on GitHub Pages and contains no personal data.',
        'Pages load a typeface from Google Fonts, which means your browser contacts Google’s servers when a page opens.')),

    sec('6. On your device',
      p('The site keeps your login session in your browser’s storage so you stay signed in. It uses no tracking cookies. Signing out removes the session.')),

    sec('7. How long we keep it',
      ul('Payment, dues, receipt and audit records are kept for as long as the class fund exists, because they are the group’s financial history.',
        'If you leave the group, your account can be blocked and your record marked inactive, but past payments stay in the class records.',
        'Login accounts that were never approved can be removed on request.')),

    sec('8. Your rights',
      ul('Ask to see the information we hold about you.',
        'Correct your name yourself under Account, or ask an admin to correct other details.',
        'Ask for your account to be closed. Financial records connected to payments you made are kept, as explained above.',
        'Complain to the Data Protection Commission of Ghana if you think your information has been misused.')),

    sec('9. Security',
      p('Access is protected by passwords, every table is locked down so people only reach what they are allowed to, and every change to money records goes through checked database functions and the audit log. No system is perfectly secure; tell an admin straight away if you think your account has been used by someone else.')),

    sec('10. Contact and changes',
      p('Questions or requests about your information: speak to any of the class admins (listed in the class WhatsApp group). If this policy changes, the date at the top will change too.')));
}
