import { h, table, badge, person, select, fmtDate, toast, pageHead, ROLE } from './ui.js';
import { listUsers, setUserStatus } from './api.js';
import { openDetails } from './details.js';

export async function render(root, ctx) {
    const filter = { role: 'all', status: 'pending' };
    const holder = h('div');


    /** Apply an approval or a reasoned rejection, then refresh the queue. */
    const decide = async (user, status) => {
        let reason = '';

        if (status === 'rejected') {
            const enteredReason = window.prompt(
                `Why is ${user.name}'s application being rejected?\n\n` +
                'Explain what information or documents need correction.'
            );

            // Cancel was clicked.
            if (enteredReason === null) return;

            reason = enteredReason.trim();

            if (!reason) {
                toast('A rejection reason is required.');
                return;
            }
        }

        try {
            const result = await setUserStatus(user, status);

            if (status === 'active') {
                toast(`Approved ${user.name}`);
            } else {
                toast(
                    result.emailSent
                        ? `Rejected ${user.name}. Email sent.`
                        : `Rejected ${user.name}, but the email was not sent.`
                );
            }

            await draw();
            ctx.refreshBadge();
        } catch (err) {
            console.error('Could not update application:', err);
            toast(err.message || 'Could not update this application.');
        }
    };


    /** Render applicants matching the current role, status, and search filters. */
    const draw = async () => {
        try {
            const q = ctx.query.toLowerCase();
            const rows = (await listUsers()).filter((u) =>
                u.status !== 'suspended' &&
                (filter.role === 'all' || u.role === filter.role) &&
                (filter.status === 'all' || u.status === filter.status) &&
                `${u.name} ${u.email}`.toLowerCase().includes(q));

            holder.replaceChildren(table([
                { label: 'Applicant', cell: person },
                { label: 'Email', cell: (u) => u.email },
                { label: 'Role', cell: (u) => ROLE[u.role].label.slice(0, -1) },
                { label: 'Submitted', cell: (u) => fmtDate(u.joined) },
                { label: 'Status', cell: (u) => badge(u.status) },
                {
                    label: 'Action',
                    cell: (u) => h('div', { class: 'actions' },
                        h('button', { class: 'btn ghost', type: 'button', onclick: () => openDetails(u, (s) => decide(u, s)) }, 'View details'),
                        u.status === 'pending' ? h('button', { class: 'btn', type: 'button', onclick: () => decide(u, 'active') }, 'Approve') : null,
                        u.status === 'pending' ? h('button', { class: 'btn danger', type: 'button', onclick: () => decide(u, 'rejected') }, 'Reject') : null),
                },
            ], rows, 'No applications match these filters.'));
        } catch (err) {
            console.error('Failed to load applications:', err);
            holder.replaceChildren(h('p', { class: 'msg error' }, 'Could not load applications. Check the browser console and Supabase permissions.'));
        }
    };

    const refresh = h('button', { class: 'btn ghost', type: 'button' }, 'Refresh');
    refresh.addEventListener('click', async () => {
        refresh.disabled = true;
        await draw();
        refresh.disabled = false;
    });

    root.append(
        pageHead('Registration applications', 'Review pending farmers, buyers, and suppliers.'),
        h('section', { class: 'card' },
            h('div', { class: 'toolbar' },
                select([['all', 'All roles'], ['farmer', 'Farmers'], ['buyer', 'Buyers'], ['supplier', 'Suppliers']], filter.role,
                    (v) => { filter.role = v; draw(); }, 'Applicant role'),
                select([['pending', 'Pending'], ['active', 'Approved'], ['rejected', 'Rejected'], ['all', 'All statuses']], filter.status,
                    (v) => { filter.status = v; draw(); }, 'Application status'),
                refresh),
            holder));
    await draw();
}
