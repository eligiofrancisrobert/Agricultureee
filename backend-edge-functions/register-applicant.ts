import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://eligiofrancisrobert.github.io",
]);

const BUCKET = "registration-documents";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_REQUEST_SIZE = 22 * 1024 * 1024;
const MAX_PASSWORD_LENGTH = 128;
const MAX_FARMS = 20;
const MAX_CROPS_PER_FARM = 50;

type Role = "farmer" | "buyer" | "supplier";

type FarmerType =
  | "owner_operator"
  | "tenant_lessee"
  | "hired_farmer";

type FarmRegistration = {
  farmName: string;
  farmLocation: string;
  crops: string[];
};

type DocumentUpload = {
  type: string;
  file: File | null;
  required: boolean;
};

type RoleDetails = Record<string, unknown>;

/*
 * Maps the public farmer types to the values accepted by the
 * CHECK constraint on farmer_details.farming_arrangement.
 *
 * IMPORTANT: these values must match your database exactly.
 * Check them with:
 *
 *   select pg_get_constraintdef(oid)
 *   from pg_constraint
 *   where conrelid = 'public.farmer_details'::regclass
 *     and contype = 'c';
 *
 * If the constraint lists "farm_operator_manager" instead of "owner",
 * change the owner_operator value below.
 */
const FARMING_ARRANGEMENT: Record<FarmerType, string> = {
  owner_operator: "owner",
  tenant_lessee: "tenant_lessee",
  hired_farmer: "farm_worker",
};

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function getCorsHeaders(
  origin: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function jsonResponse(
  body: unknown,
  status = 200,
  origin: string | null = null,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function required(
  form: FormData,
  key: string,
  maxLength = 300,
): string {
  const value = form.get(key);

  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(
      `Missing required field: ${key}`,
    );
  }

  const result = value.trim();

  if (result.length > maxLength) {
    throw new ValidationError(`${key} is too long.`);
  }

  return result;
}

function optional(
  form: FormData,
  key: string,
  maxLength = 300,
): string | null {
  const value = form.get(key);

  if (value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new ValidationError(`Invalid field: ${key}`);
  }

  const result = value.trim();

  if (!result) {
    return null;
  }

  if (result.length > maxLength) {
    throw new ValidationError(`${key} is too long.`);
  }

  return result;
}

function validatePassword(password: string): void {
  if (
    password.length < 12 ||
    password.length > MAX_PASSWORD_LENGTH ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new ValidationError(
      "Password must be 12–128 characters and include lowercase, uppercase, a number, and a symbol.",
    );
  }
}

function validateEmail(email: string): void {
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new ValidationError(
      "Please enter a valid email address.",
    );
  }
}

function getFile(
  form: FormData,
  key: string,
): File | null {
  const value = form.get(key);

  if (value === null) {
    return null;
  }

  if (!(value instanceof File) || value.size === 0) {
    throw new ValidationError(`Invalid file for ${key}.`);
  }

  if (value.size > MAX_FILE_SIZE) {
    throw new ValidationError(
      `${key} must not exceed 5 MB.`,
    );
  }

  return value;
}

async function detectFileType(file: File): Promise<string> {
  const bytes = new Uint8Array(
    await file.slice(0, 12).arrayBuffer(),
  );

  const matches = (...signature: number[]) =>
    signature.every(
      (byte, index) => bytes[index] === byte,
    );

  if (matches(0x25, 0x50, 0x44, 0x46, 0x2D)) {
    return "application/pdf";
  }

  if (
    matches(
      0x89,
      0x50,
      0x4E,
      0x47,
      0x0D,
      0x0A,
      0x1A,
      0x0A,
    )
  ) {
    return "image/png";
  }

  if (matches(0xFF, 0xD8, 0xFF)) {
    return "image/jpeg";
  }

  if (
    matches(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) ||
    matches(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)
  ) {
    return "image/gif";
  }

  if (
    matches(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  throw new ValidationError(
    "Uploaded documents must be valid JPEG, PNG, GIF, WebP, or PDF files.",
  );
}

function productNames(value: string): string[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = value.split(",");
  }

  const values = Array.isArray(parsed) ? parsed : [parsed];

  if (values.length > MAX_CROPS_PER_FARM) {
    throw new ValidationError(
      `Please select no more than ${MAX_CROPS_PER_FARM} products or crops.`,
    );
  }

  if (
    values.some((item) => typeof item !== "string")
  ) {
    throw new ValidationError(
      "Invalid product or crop selection.",
    );
  }

  const result = [
    ...new Set(
      (values as string[])
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];

  if (result.some((item) => item.length > 80)) {
    throw new ValidationError(
      "Each product or crop name must not exceed 80 characters.",
    );
  }

  return result;
}

function parseFarms(raw: string): FarmRegistration[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError(
      "Invalid farm information. Please review your farm entries.",
    );
  }

  if (!Array.isArray(parsed)) {
    throw new ValidationError(
      "Farm information must be a list of farms.",
    );
  }

  if (parsed.length > MAX_FARMS) {
    throw new ValidationError(
      `You may register up to ${MAX_FARMS} farms at a time.`,
    );
  }

  return parsed.map((item, index) => {
    if (
      item === null ||
      typeof item !== "object" ||
      Array.isArray(item)
    ) {
      throw new ValidationError(
        `Farm ${index + 1} contains invalid information.`,
      );
    }

    const farm = item as Record<string, unknown>;

    const farmName =
      typeof farm.farmName === "string"
        ? farm.farmName.trim()
        : "";

    const farmLocation =
      typeof farm.farmLocation === "string"
        ? farm.farmLocation.trim()
        : "";

    if (!farmName) {
      throw new ValidationError(
        `Please enter a name for Farm ${index + 1}.`,
      );
    }

    if (farmName.length > 120) {
      throw new ValidationError(
        `The name of Farm ${index + 1} is too long.`,
      );
    }

    if (!farmLocation) {
      throw new ValidationError(
        `Please enter the location for Farm ${index + 1}.`,
      );
    }

    if (farmLocation.length > 300) {
      throw new ValidationError(
        `The location of Farm ${index + 1} is too long.`,
      );
    }

    if (!Array.isArray(farm.crops)) {
      throw new ValidationError(
        `Please select crops for Farm ${index + 1}.`,
      );
    }

    const crops = productNames(
      JSON.stringify(farm.crops),
    );

    if (crops.length === 0) {
      throw new ValidationError(
        `Please select at least one crop for Farm ${index + 1}.`,
      );
    }

    return {
      farmName,
      farmLocation,
      crops,
    };
  });
}

function validateFarmerType(value: string): FarmerType {
  if (
    value !== "owner_operator" &&
    value !== "tenant_lessee" &&
    value !== "hired_farmer"
  ) {
    throw new ValidationError(
      "Please select a valid farmer type.",
    );
  }

  return value;
}

function safeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(-100);
}

async function cleanupUserRecords(
  db: ReturnType<typeof createClient>,
  userId: string,
): Promise<void> {
  /*
   * Remove child crop records before farm records.
   * These records may already exist because the Auth trigger
   * runs when the user is created.
   */
  try {
    const { data: farms, error: farmsReadError } = await db
      .from("farmer_farms")
      .select("id")
      .eq("farmer_id", userId);

    if (farmsReadError) {
      console.error(
        "Could not retrieve farms for cleanup:",
        farmsReadError.message,
      );
    } else {
      const farmIds = (farms ?? []).map(
        (farm: { id: string }) => farm.id,
      );

      if (farmIds.length > 0) {
        const { error: cropCleanupError } = await db
          .from("farmer_farm_crops")
          .delete()
          .in("farm_id", farmIds);

        if (cropCleanupError) {
          console.error(
            "Farm crop cleanup failed:",
            cropCleanupError.message,
          );
        }
      }
    }
  } catch (error) {
    console.error("Farm crop cleanup threw an error:", error);
  }

  const cleanupSteps = [
    () =>
      db.from("registration_documents")
        .delete()
        .eq("user_id", userId),

    () =>
      db.from("farmer_farms")
        .delete()
        .eq("farmer_id", userId),

    () =>
      db.from("farmer_crops")
        .delete()
        .eq("user_id", userId),

    () =>
      db.from("buyer_interests")
        .delete()
        .eq("user_id", userId),

    () =>
      db.from("supplier_products")
        .delete()
        .eq("user_id", userId),

    () =>
      db.from("farmer_details")
        .delete()
        .eq("user_id", userId),

    () =>
      db.from("buyer_details")
        .delete()
        .eq("user_id", userId),

    () =>
      db.from("supplier_details")
        .delete()
        .eq("user_id", userId),

    () =>
      db.from("profiles")
        .delete()
        .eq("id", userId),
  ];

  for (const cleanup of cleanupSteps) {
    try {
      const { error } = await cleanup();

      if (error) {
        console.error(
          "Registration database cleanup failed:",
          error.message,
        );
      }
    } catch (error) {
      console.error(
        "Registration cleanup threw an error:",
        error,
      );
    }
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(origin),
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed." },
      405,
      origin,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get(
    "SUPABASE_SERVICE_ROLE_KEY",
  );

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Registration server configuration is incomplete.",
    );

    return jsonResponse(
      { error: "Registration is temporarily unavailable." },
      500,
      origin,
    );
  }

  const db = createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  let userId: string | null = null;
  const uploadedPaths: string[] = [];

  try {
    const contentLength = req.headers.get("content-length");

    if (contentLength !== null) {
      const length = Number(contentLength);

      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_REQUEST_SIZE
      ) {
        throw new ValidationError(
          "The submitted form is too large.",
        );
      }
    }

    if (!req.body) {
      throw new ValidationError(
        "The submitted form is empty.",
      );
    }

    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      totalBytes += value.byteLength;

      if (totalBytes > MAX_REQUEST_SIZE) {
        await reader.cancel();

        throw new ValidationError(
          "The submitted form is too large.",
        );
      }

      chunks.push(value);
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;

    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    let form: FormData;

    try {
      const formRequest = new Request(req.url, {
        method: "POST",
        headers: req.headers,
        body,
      });

      form = await formRequest.formData();
    } catch {
      throw new ValidationError(
        "Invalid form submission.",
      );
    }

    const roleValue = required(form, "role", 30).toLowerCase();

    if (
      !["farmer", "buyer", "supplier"].includes(roleValue)
    ) {
      throw new ValidationError(
        "Invalid registration role.",
      );
    }

    const role = roleValue as Role;
    const email = required(form, "email", 254).toLowerCase();

    validateEmail(email);

    const password = required(
      form,
      "password",
      MAX_PASSWORD_LENGTH,
    );

    validatePassword(password);

    const firstName = required(form, "firstName", 60);
    const middleName = optional(form, "middleName", 60) ?? "";
    const surname = required(form, "surname", 60);
    const suffix = optional(form, "suffix", 10) ?? "";

    const fullName = [
      firstName,
      middleName,
      surname,
      suffix,
    ].filter(Boolean).join(" ");

    const phone = required(form, "phone", 30);

    const residentialAddress =
      optional(form, "address", 300) ??
      optional(form, "residentialAddress", 300) ??
      "";

    let roleDetails: RoleDetails;
    const documents: DocumentUpload[] = [];

    // ---------------------------------------------------------
    // FARMER REGISTRATION
    // ---------------------------------------------------------
    if (role === "farmer") {
      const farmerType = validateFarmerType(
        required(form, "farmerType", 30),
      );

      const farmsRaw = required(form, "farms", 20000);
      const submittedFarms = parseFarms(farmsRaw);

      let farms: FarmRegistration[] = [];

      if (farmerType === "owner_operator") {
        if (submittedFarms.length === 0) {
          throw new ValidationError(
            "Owner/Operators must register at least one farm.",
          );
        }

        farms = submittedFarms;
      } else if (submittedFarms.length > 0) {
        throw new ValidationError(
          "Tenant/Lessee and Hired Farmer accounts cannot register farms as owners. You can be assigned to an existing farm after approval.",
        );
      }

      /*
       * Preserve compatibility with existing database fields.
       * These values are also sent for older code that still reads
       * the first farm's legacy fields.
       */
      const firstFarm = farms[0];

      const legacyCrops = firstFarm
        ? firstFarm.crops.join(",")
        : "";

      // Must match farmer_details' CHECK constraint (see the
      // FARMING_ARRANGEMENT map at the top of this file).
      const farmingArrangement = FARMING_ARRANGEMENT[farmerType];

      roleDetails = {
        farmerType,
        farmingArrangement,
        farming_arrangement: farmingArrangement,

        // New multi-farm structure for the updated trigger.
        farms,

        // Legacy fields retained for compatibility.
        farmName: firstFarm?.farmName ?? "",
        farmLocation: firstFarm?.farmLocation ?? "",
        crops: legacyCrops,
      };

      documents.push({
        type: "farmer_id",
        file: getFile(form, "farmerId"),
        required: true,
      });

      documents.push({
        type: "farm_proof",
        file: getFile(form, "farmProof"),
        required: farmerType === "owner_operator",
      });
    }

    // ---------------------------------------------------------
    // BUYER REGISTRATION
    // ---------------------------------------------------------
    else if (role === "buyer") {
      const products = productNames(
        required(form, "buyerProducts", 4000),
      );

      if (products.length === 0) {
        throw new ValidationError(
          "Please enter at least one preferred product.",
        );
      }

      const buyerType = required(form, "buyerType", 30);

      if (
        !["individual", "business"].includes(buyerType)
      ) {
        throw new ValidationError(
          "Invalid buyer type.",
        );
      }

      const businessName =
        optional(form, "businessName", 120) ?? "";

      if (buyerType === "business" && !businessName) {
        throw new ValidationError(
          "Business name is required for business buyers.",
        );
      }

      roleDetails = {
        buyerType,
        businessName,
        preferredProducts: products.join(","),
      };

      documents.push({
        type: "buyer_id",
        file: getFile(form, "buyerId"),
        required: true,
      });

      if (buyerType === "business") {
        documents.push({
          type: "buyer_permit",
          file: getFile(form, "buyerPermit"),
          required: true,
        });
      }
    }

    // ---------------------------------------------------------
    // SUPPLIER REGISTRATION
    // ---------------------------------------------------------
    else {
      const products = productNames(
        required(form, "productsSupplied", 4000),
      );

      if (products.length === 0) {
        throw new ValidationError(
          "Please enter at least one product supplied.",
        );
      }

      roleDetails = {
        businessName: required(
          form,
          "businessName",
          120,
        ),
        businessAddress: required(
          form,
          "businessAddress",
          300,
        ),
        productsSupplied: products.join(","),
      };

      documents.push({
        type: "supplier_id",
        file: getFile(form, "supplierId"),
        required: true,
      });

      documents.push({
        type: "supplier_permit",
        file: getFile(form, "businessPermit"),
        required: true,
      });
    }

    // ---------------------------------------------------------
    // DOCUMENT VALIDATION
    // ---------------------------------------------------------
    const detectedMimeTypes = new Map<File, string>();

    for (const document of documents) {
      if (!document.file) {
        if (document.required) {
          throw new ValidationError(
            `Please upload the required ${document.type.replaceAll("_", " ")} document.`,
          );
        }

        continue;
      }

      const mimeType = await detectFileType(document.file);
      detectedMimeTypes.set(document.file, mimeType);
    }

    // ---------------------------------------------------------
    // CREATE AUTH USER
    // The existing Auth trigger creates the profile and role data.
    // Do not duplicate those database inserts here.
    // ---------------------------------------------------------
    const { data: authData, error: authError } =
      await db.auth.admin.createUser({
        email,
        password,
        email_confirm: false,

        user_metadata: {
          first_name: firstName,
          middle_name: middleName || null,
          surname,
          suffix: suffix || null,
          full_name: fullName,
          role,
          phone,
          residential_address: residentialAddress,
          role_details: roleDetails,
        },
      });

    if (authError) {
      // Log full details server-side only; the client gets a
      // generic message from the catch block below.
      console.error("Auth account creation failed:", {
        message: authError.message,
        status: authError.status,
        code: authError.code,
        role,
      });

      throw new Error("Account creation failed.");
    }

    if (!authData.user) {
      throw new Error(
        "Account creation returned no user.",
      );
    }

    userId = authData.user.id;

    // ---------------------------------------------------------
    // UPLOAD DOCUMENTS
    // ---------------------------------------------------------
    const documentRows: {
      user_id: string;
      document_type: string;
      storage_path: string;
    }[] = [];

    for (const document of documents) {
      if (!document.file) continue;

      const mimeType = detectedMimeTypes.get(
        document.file,
      );

      if (!mimeType) {
        throw new Error(
          "Document validation was incomplete.",
        );
      }

      const path =
        `${userId}/${document.type}_${crypto.randomUUID()}_${safeFileName(document.file.name)}`;

      const { error: uploadError } = await db.storage
        .from(BUCKET)
        .upload(path, document.file, {
          contentType: mimeType,
          upsert: false,
        });

      if (uploadError) {
        console.error(
          "Registration document upload failed:",
          uploadError.message,
        );

        throw new Error("Document upload failed.");
      }

      uploadedPaths.push(path);

      documentRows.push({
        user_id: userId,
        document_type: document.type,
        storage_path: path,
      });
    }

    if (documentRows.length > 0) {
      const { error: documentsError } = await db
        .from("registration_documents")
        .insert(documentRows);

      if (documentsError) {
        console.error(
          "Registration document record insertion failed:",
          documentsError.message,
        );

        throw new Error(
          "Document registration failed.",
        );
      }
    }

    return jsonResponse(
      {
        success: true,
        message:
          "Registration submitted successfully. Your application is pending approval.",
        userId,
      },
      200,
      origin,
    );
  } catch (error) {
    const isValidationError =
      error instanceof ValidationError;

    const clientMessage = isValidationError
      ? error.message
      : "Registration failed. Please review your information or try again later.";

    if (!isValidationError) {
      console.error("register-applicant internal error:", {
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

    // Remove files that were uploaded before a later step failed.
    if (uploadedPaths.length > 0) {
      const { error: storageCleanupError } =
        await db.storage
          .from(BUCKET)
          .remove(uploadedPaths);

      if (storageCleanupError) {
        console.error(
          "Registration storage cleanup failed:",
          storageCleanupError.message,
        );
      }
    }

    /*
     * Auth creation runs the database trigger. If a later document
     * upload or insert fails, remove the trigger-created records too.
     */
    if (userId) {
      await cleanupUserRecords(db, userId);

      try {
        const { error: deleteUserError } =
          await db.auth.admin.deleteUser(userId);

        if (deleteUserError) {
          console.error(
            "Registration Auth cleanup failed:",
            deleteUserError.message,
          );
        }
      } catch (cleanupError) {
        console.error(
          "Registration Auth cleanup threw an error:",
          cleanupError,
        );
      }
    }

    return jsonResponse(
      { error: clientMessage },
      isValidationError ? 400 : 500,
      origin,
    );
  }
});