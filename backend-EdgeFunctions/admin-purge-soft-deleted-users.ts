
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const allowedRoles = ['farmer', 'buyer', 'supplier'];

Deno.serve(async (req) => {
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return respond({ success: false, error: 'Method not allowed.' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey =
      Deno.env.get('SUPABASE_ANON_KEY') ??
      Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('Missing Supabase environment variables.');
    }

    const authorization = req.headers.get('Authorization');

    if (!authorization) {
      return respond({ success: false, error: 'Unauthorized.' }, 401);
    }

    const caller = createClient(supabaseUrl, anonKey, {
      global: {
        headers: { Authorization: authorization },
      },
    });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const {
      data: { user },
      error: authError,
    } = await caller.auth.getUser();

    if (authError || !user) {
      return respond({ success: false, error: 'Invalid session.' }, 401);
    }

    const { data: adminRecord, error: adminError } = await admin
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (adminError || !adminRecord) {
      return respond({ success: false, error: 'Admin access required.' }, 403);
    }

    const body = await req.json().catch(() => null);

    if (body?.confirm !== true) {
      return respond({
        success: false,
        error: 'Explicit deletion confirmation is required.',
      }, 400);
    }

    const userIds = body?.userIds;

    if (
      !Array.isArray(userIds) ||
      userIds.length !== 1 ||
      typeof userIds[0] !== 'string'
    ) {
      return respond({
        success: false,
        error: 'Provide exactly one valid user ID.',
      }, 400);
    }

    const targetId = userIds[0];

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(targetId)) {
      return respond({ success: false, error: 'Invalid user ID format.' }, 400);
    }

    if (targetId === user.id) {
      return respond({
        success: false,
        error: 'You cannot delete your own account.',
      }, 403);
    }

    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id, role, status, deleted_at')
      .eq('id', targetId)
      .maybeSingle();

    if (targetError) throw targetError;

    if (!target) {
      return respond({
        success: false,
        error: 'Account profile not found.',
      }, 404);
    }

    if (
      !target.deleted_at ||
      target.status !== 'suspended' ||
      !allowedRoles.includes(target.role)
    ) {
      return respond({
        success: false,
        error: 'Only soft-deleted, suspended applicant accounts can be permanently deleted.',
      }, 400);
    }

    // Permanently delete the selected Auth account.
    const { error: deleteError } =
      await admin.auth.admin.deleteUser(target.id);

    if (deleteError) {
      const errorDetails = {
        name: deleteError.name,
        message: deleteError.message,
        status: deleteError.status,
        code: deleteError.code,
        details: JSON.stringify(deleteError, Object.getOwnPropertyNames(deleteError)),
        userId: target.id,
      };

      console.error('AUTH DELETE DEBUG:', errorDetails);

      return respond({
        success: false,
        error: deleteError.message,
        debug: errorDetails,
        userId: target.id,
      }, 500);
    }

    return respond({
      success: true,
      message: 'Account permanently deleted.',
      totalFound: 1,
      totalDeleted: 1,
      totalFailed: 0,
      deleted: [{
        id: target.id,
        role: target.role,
      }],
      failed: [],
    });

  } catch (error) {
    console.error('Permanent deletion error:', error);

    return respond({
      success: false,
      error: error instanceof Error
        ? error.message
        : 'Unexpected error.',
    }, 500);
  }
});
