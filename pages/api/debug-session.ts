import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const supabase = createPagesServerClient({ req, res });
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      hasSession: Boolean(session),
      user: session?.user ?? null,
    });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: err?.message || "Unable to retrieve Supabase session" });
  }
}
