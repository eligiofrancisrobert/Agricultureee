
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authorization = req.headers.get('Authorization')
    if (!authorization) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const caller = createClient(url, anonKey, {
      global: {
        headers: { Authorization: authorization },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    const admin = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    // Verify the caller's actual Supabase Auth identity.
    const {
      data: { user },
      error: userError,
    } = await caller.auth.getUser()

    if (userError || !user) {
      return json({ error: 'Unauthorized' }, 401)
    }

    // Verify that this authenticated user is an administrator.
    const { data: adminRecord, error: adminError } = await admin
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (adminError) {
      console.error('Admin verification failed:', adminError)
      return json({ error: 'Could not verify administrator' }, 500)
    }

    if (!adminRecord) {
      return json({ error: 'Forbidden' }, 403)
    }

    let body: { staffId?: string }

    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON request body' }, 400)
    }

    const staffId = body.staffId

    if (
      typeof staffId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(staffId)
    ) {
      return json({ error: 'A valid staffId is required' }, 400)
    }

    // The database function rechecks admin membership, account status,
    // and self-deletion, then deletes within the audit context.
    const { data: result, error: deleteError } = await admin.rpc(
      'admin_delete_staff',
      {
        p_staff_id: staffId,
        p_actor_id: user.id,
      },
    )

    if (deleteError) {
      console.error('Staff deletion failed:', deleteError)

      if (deleteError.code === 'P0002') {
        return json({ error: 'Account not found.', code: 'PGRST116' }, 404)
      }

      if (deleteError.code === '42501') {
        const message = deleteError.message ?? ''

        if (message.includes('own login')) {
          return json({
            error: 'You cannot delete your own login.',
            code: 'SELF_DELETE',
          }, 400)
        }

        return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)
      }

      if (deleteError.code === '23514') {
        return json({
          error: 'Only accounts marked Deleted can be removed permanently.',
          code: 'NOT_DELETED',
        }, 400)
      }

      return json({
        error: 'Could not delete the staff account.',
        code: deleteError.code,
      }, 400)
    }

    // Remove the Supabase Auth login after the staff record is deleted.
    // A failed Auth deletion is reported so it can be handled manually.
    const userId = result?.userId as string | null | undefined

    if (userId) {
      const { error: authError } = await admin.auth.admin.deleteUser(userId)

      if (authError) {
        console.error('Auth user deletion failed:', authError)

        return json({
          ok: true,
          loginRemoved: false,
          warning:
            'Staff record deleted and audited, but the login could not be removed. Remove it under Authentication > Users.',
        })
      }

      return json({ ok: true, loginRemoved: true })
    }

    return json({ ok: true, loginRemoved: false })
  } catch (error) {
    console.error('Unexpected delete-staff error:', error)
    return json({ error: 'An unexpected error occurred.' }, 500)
  }
})
