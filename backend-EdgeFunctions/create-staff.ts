
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

const SELECT =
  'staff_id, full_name, email, role_id, status_id, staff_roles(role_name), account_statuses(status_name)'

const ALLOWED_PROFILE_ROLES = new Set([
  'farmer',
  'buyer',
  'supplier',
  'admin',
  'Farm Manager',
  'Agricultural Technician',
  'Warehouse Officer',
  'Accountant',
  'Administrator',
])

const COMMON_WORDS = [
  'password', 'passw0rd', 'qwerty', 'asdfgh', 'zxcvb', '123456',
  '111111', '000000', 'abc123', 'welcome', 'letmein', 'admin',
  'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'login',
  'master', 'sunshine', 'princess', 'tanikala', 'philippines',
  'manila', 'changeme', 'default', 'secret', 'superman', 'batman',
]

function passwordProblem(pw: string, email: string): string {
  if (pw.length < 10) return 'Use at least 10 characters.'
  if (!/[a-z]/.test(pw)) return 'Add at least one lowercase letter.'
  if (!/[A-Z]/.test(pw)) return 'Add at least one uppercase letter.'
  if (!/\d/.test(pw)) return 'Add at least one number.'
  if (!/[^A-Za-z0-9]/.test(pw)) {
    return 'Add at least one special character, like ! @ # $ %.'
  }

  const lower = pw.toLowerCase()
  const leet = lower
    .replace(/@/g, 'a')
    .replace(/0/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/[$5]/g, 's')
    .replace(/7/g, 't')

  const strip = (s: string) => s.replace(/[^a-z0-9]/g, '')
  const forms = [strip(lower), strip(leet)]

  if (COMMON_WORDS.some((w) => forms.some((f) => f.includes(w)))) {
    return 'This password is too common or easy to guess. Choose something less predictable.'
  }

  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
  if (local.length >= 4 && forms.some((f) => f.includes(local))) {
    return 'The password must not contain the email name.'
  }

  return ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const caller = createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: req.headers.get('Authorization') ?? '',
      },
    },
  })

  const admin = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  // Only authenticated administrators may create staff accounts.
  const {
    data: { user },
    error: authUserError,
  } = await caller.auth.getUser()

  if (authUserError || !user) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const { data: isAdmin, error: adminCheckError } = await admin
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (adminCheckError) {
    console.error('Admin verification failed:', adminCheckError)
    return json({ error: 'Could not verify administrator access' }, 500)
  }

  if (!isAdmin) {
    return json({ error: 'Forbidden' }, 403)
  }

  let body: {
    name?: string
    email?: string
    roleId?: number
    statusId?: number
    password?: string
  }

  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON request body' }, 400)
  }

  const name = body.name?.trim().replace(/\s+/g, ' ')
  const email = body.email?.trim().toLowerCase()
  const { roleId, statusId, password } = body

  if (
    !name ||
    name.length < 2 ||
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !Number.isInteger(roleId) ||
    !Number.isInteger(statusId) ||
    !password
  ) {
    return json({ error: 'Missing or invalid fields' }, 400)
  }

  const problem = passwordProblem(password, email)

  if (problem) {
    return json({ error: problem, code: 'WEAK_PASSWORD' }, 400)
  }

  // Validate the selected role and status before creating the Auth user.
  const [roleResult, statusResult] = await Promise.all([
    admin
      .from('staff_roles')
      .select('role_id, role_name')
      .eq('role_id', roleId)
      .maybeSingle(),

    admin
      .from('account_statuses')
      .select('status_id, status_name')
      .eq('status_id', statusId)
      .maybeSingle(),
  ])

  if (roleResult.error || statusResult.error) {
    console.error(
      'Role/status lookup failed:',
      roleResult.error ?? statusResult.error,
    )
    return json({ error: 'Could not validate the selected role or status' }, 500)
  }

  const role = roleResult.data
  const status = statusResult.data

  if (!role || !status) {
    return json({ error: 'Invalid role or status selection' }, 400)
  }

  // These values must match profiles_role_check exactly.
  if (!ALLOWED_PROFILE_ROLES.has(role.role_name)) {
    return json({
      error: `The role "${role.role_name}" is not allowed in profiles.`,
    }, 400)
  }

  // Create the authentication account.
  const { data: created, error: createAuthError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

  if (createAuthError || !created.user) {
    console.error('Auth user creation failed:', createAuthError)

    const isDuplicate =
      createAuthError?.code === 'email_exists' ||
      /already registered|already been registered/i.test(
        createAuthError?.message ?? '',
      )

    return json({
      error: isDuplicate
        ? 'Another account already uses this email.'
        : createAuthError?.message ?? 'Could not create authentication account.',
      code: isDuplicate ? '23505' : createAuthError?.code,
    }, 400)
  }

  const userId = created.user.id

  // Create the matching profile using the SAME UUID as the Auth user.
  const { error: profileError } = await admin
    .from('profiles')
    .insert({
      id: userId,
      full_name: name,
      email,
      role: role.role_name,
      status: status.status_name.toLowerCase(),
    })

  if (profileError) {
    console.error('Profile creation failed:', profileError)

    // Roll back the newly created Auth account.
    const { error: rollbackError } =
      await admin.auth.admin.deleteUser(userId)

    if (rollbackError) {
      console.error('Auth rollback failed:', rollbackError)
    }

    return json({
      error: `Could not create staff profile: ${profileError.message}`,
      code: profileError.code,
    }, 400)
  }

  // Create the staff-management record.
  const { data: staffRow, error: staffError } = await admin
    .from('staff_accounts')
    .insert({
      full_name: name,
      email,
      role_id: roleId,
      status_id: statusId,
      user_id: userId,
    })
    .select(SELECT)
    .single()

  if (staffError) {
    console.error('Staff record creation failed:', staffError)

    // Clean up the profile and Auth user if staff creation fails.
    const { error: profileRollbackError } = await admin
      .from('profiles')
      .delete()
      .eq('id', userId)

    if (profileRollbackError) {
      console.error('Profile rollback failed:', profileRollbackError)
    }

    const { error: authRollbackError } =
      await admin.auth.admin.deleteUser(userId)

    if (authRollbackError) {
      console.error('Auth rollback failed:', authRollbackError)
    }

    return json({
      error: `Could not create staff account: ${staffError.message}`,
      code: staffError.code,
    }, 400)
  }

  return json(staffRow)
})
