import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Method not allowed",
      message:
        "Use /api/reviews/create for submissions, /api/reviews/listing for listing reviews, and /api/reviews/eligibility for review eligibility.",
    });
  }

  return res.status(200).json({
    ok: true,
    endpoints: {
      create: "/api/reviews/create",
      listing: "/api/reviews/listing?listingId=<id>",
      guest: "/api/reviews/guest?guestId=<id>",
      eligibility: "/api/reviews/eligibility?bookingId=<id>",
      publishPending: "/api/reviews/publish-pending",
    },
  });
}

