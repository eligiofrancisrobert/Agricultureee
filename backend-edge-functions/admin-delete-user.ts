
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
    return json({
      success: false,
      error: 'Method not allowed.',
    }, 405)
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')
    const anonKey =
      Deno.env.get('SUPABASE_ANON_KEY') ??
      Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
      Deno.env.get('SERVICE_ROLE_KEY')

    if (!url || !anonKey || !serviceRoleKey) {
      console.error('Required Supabase environment variables are missing.')

      return json({
        success: false,
        error: 'Server configuration error.',
      }, 500)
    }

    const authorization = req.headers.get('Authorization')

    if (!authorization) {
      return json({
        success: false,
        error: 'Unauthorized.',
      }, 401)
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

    // Verify actual Supabase Auth identity.
    const {
      data: { user },
      error: userError,
    } = await caller.auth.getUser()

    if (userError || !user) {
      return json({
        success: false,
        error: 'Unauthorized.',
      }, 401)
    }

    // Verify administrator membership.
    const { data: adminRecord, error: adminError } = await admin
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (adminError) {
      console.error('Admin verification failed:', adminError)

      return json({
        success: false,
        error: 'Could not verify administrator.',
      }, 500)
    }

    if (!adminRecord) {
      return json({
        success: false,
        error: 'Forbidden.',
      }, 403)
    }

    // Validate request body.
    let body: { userId?: string }

    try {
      body = await req.json()
    } catch {
      return json({
        success: false,
        error: 'Invalid JSON request body.',
      }, 400)
    }

    const userId = body.userId

    if (
      typeof userId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
    ) {
      return json({
        success: false,
        error: 'A valid userId is required.',
      }, 400)
    }

    // Prevent self-deletion.
    if (userId === user.id) {
      return json({
        success: false,
        error: 'You cannot delete your own account.',
      }, 400)
    }

    // Perform soft deletion through the database RPC.
    const { data: result, error: deleteError } = await admin.rpc(
      'admin_delete_applicant',
      {
        p_user_id: userId,
        p_actor_id: user.id,
      },
    )

    if (deleteError) {
      console.error('Soft deletion failed:', deleteError)

      if (deleteError.code === 'P0002') {
        return json({
          success: false,
          error: 'Account not found.',
        }, 404)
      }

      if (deleteError.code === '42501') {
        return json({
          success: false,
          error: deleteError.message.includes('own account')
            ? 'You cannot delete your own account.'
            : 'This account cannot be soft deleted.',
        }, 403)
      }

      if (deleteError.code === '22023') {
        return json({
          success: false,
          error: deleteError.message,
        }, 400)
      }

      return json({
        success: false,
        error: 'Could not soft delete the account.',
      }, 500)
    }

    const deleted = result as {
      ok?: boolean
      userId?: string
      role?: string
      status?: string
      softDeleted?: boolean
    } | null

    if (
      !deleted?.ok ||
      !deleted?.userId ||
      !deleted?.softDeleted
    ) {
      console.error('Unexpected soft deletion RPC result:', result)

      return json({
        success: false,
        error: 'The soft deletion result could not be verified.',
      }, 500)
    }

    return json({
      success: true,
      message: 'Account successfully soft deleted.',
      userId: deleted.userId,
      role: deleted.role,
      status: deleted.status,
      softDeleted: true,
    })

  } catch (error) {
    console.error('Unexpected soft deletion error:', error)

    return json({
      success: false,
      error: 'An unexpected error occurred.',
    }, 500)
  }
})
