
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
        },
    });
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return respond({ error: "Method not allowed." }, 405);
    }

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!supabaseUrl || !anonKey || !serviceRoleKey) {
            return respond({ error: "Server configuration is incomplete." }, 500);
        }

        const authHeader = req.headers.get("Authorization");

        if (!authHeader?.startsWith("Bearer ")) {
            return respond({ error: "Authentication required." }, 401);
        }

        const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
            auth: { autoRefreshToken: false, persistSession: false },
        });

        const {
            data: { user },
            error: userError,
        } = await userClient.auth.getUser();

        if (userError || !user) {
            return respond({ error: "Invalid authentication." }, 401);
        }

        const adminClient = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });

        const { data: admin, error: adminError } = await adminClient
            .from("admin_users")
            .select("user_id")
            .eq("user_id", user.id)
            .maybeSingle();

        if (adminError) {
            console.error("Admin verification failed:", adminError);
            return respond({ error: "Could not verify administrator access." }, 500);
        }

        if (!admin) {
            return respond({ error: "Administrator access required." }, 403);
        }

        const body = await req.json();
        const action = body.action;

        // List documents for one applicant.
        if (action === "list") {
            const userId = String(body.userId ?? "");

            if (!userId) {
                return respond({ error: "Applicant user ID is required." }, 400);
            }

            const { data: documents, error } = await adminClient
                .from("registration_documents")
                .select("id, user_id, document_type, review_status, uploaded_at")
                .eq("user_id", userId)
                .order("uploaded_at", { ascending: false });

            if (error) {
                console.error("Document listing failed:", error);
                return respond({ error: "Could not load registration documents." }, 500);
            }

            return respond({ documents: documents ?? [] });
        }

        // Generate a temporary viewing link for one document.
        if (action === "view") {
            const documentId = Number(body.documentId);

            if (!Number.isSafeInteger(documentId) || documentId <= 0) {
                return respond({ error: "A valid document ID is required." }, 400);
            }

            const { data: document, error } = await adminClient
                .from("registration_documents")
                .select("id, user_id, document_type, storage_path")
                .eq("id", documentId)
                .maybeSingle();

            if (error) {
                console.error("Document lookup failed:", error);
                return respond({ error: "Could not retrieve the document." }, 500);
            }

            if (!document) {
                return respond({ error: "Document not found." }, 404);
            }

            const { data: signed, error: signedError } = await adminClient.storage
                .from("registration-documents")
                .createSignedUrl(document.storage_path, 60);

            if (signedError || !signed?.signedUrl) {
                console.error("Signed URL creation failed:", signedError);
                return respond({ error: "Could not create a document viewing link." }, 500);
            }

            return respond({
                documentId: document.id,
                documentType: document.document_type,
                signedUrl: signed.signedUrl,
                expiresIn: 60,
            });
        }

        return respond({ error: "Unsupported action." }, 400);
    } catch (error) {
        console.error("Admin document function error:", error);
        return respond({ error: "An unexpected server error occurred." }, 500);
    }
});
