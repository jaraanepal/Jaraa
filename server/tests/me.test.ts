import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { testDeps, tokenFor, auth } from "./helpers";

let app: ReturnType<typeof testDeps>["app"];
let store: ReturnType<typeof testDeps>["store"];

beforeEach(async () => {
  ({ app, store } = testDeps());
});

async function authed() {
  const user = await store.createUser({ phone: "9841111111" });
  return { token: tokenFor(user), user };
}

async function jpeg(): Promise<Buffer> {
  // Valid 64x64 JPEG through sharp (EXIF-free, exercises the pipeline).
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 30, g: 59, b: 42 } },
  })
    .jpeg()
    .toBuffer();
}

describe("me profile + addresses + photo", () => {
  it("PATCH /me/profile updates name/age/gender and returns photo_url + addresses", async () => {
    const { token } = await authed();
    const res = await request(app)
      .patch("/api/v1/me/profile")
      .set(auth(token))
      .send({ name: "Aasha Sharma", age_band: "23-29", gender: "female" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Aasha Sharma");
    expect(res.body.age_band).toBe("23-29");
    expect(res.body.photo_url).toBeNull();
    expect(res.body.addresses).toEqual([]);
  });

  it("PATCH /me/profile rejects bad enums", async () => {
    const { token } = await authed();
    const res = await request(app)
      .patch("/api/v1/me/profile")
      .set(auth(token))
      .send({ age_band: "nonsense" });
    expect(res.status).toBe(400);
  });

  it("POST /me/profile/photo uploads and GET /me/profile serves a signed URL", async () => {
    const { token } = await authed();
    const img = await jpeg();
    const up = await request(app)
      .post("/api/v1/me/profile/photo")
      .set(auth(token))
      .attach("photo", img, "photo.jpg");
    expect(up.status).toBe(201);
    expect(typeof up.body.photo_url).toBe("string");
    expect(up.body.photo_path).toContain("profiles/");

    const get = await request(app).get("/api/v1/me/profile").set(auth(token));
    expect(get.status).toBe(200);
    expect(typeof get.body.photo_url).toBe("string");
  });

  it("POST /me/profile/photo rejects non-images", async () => {
    const { token } = await authed();
    const res = await request(app)
      .post("/api/v1/me/profile/photo")
      .set(auth(token))
      .attach("photo", Buffer.from("not an image"), "photo.jpg");
    expect(res.status).toBe(400);
  });

  it("DELETE /me/profile/photo clears the photo", async () => {
    const { token } = await authed();
    const img = await jpeg();
    await request(app)
      .post("/api/v1/me/profile/photo")
      .set(auth(token))
      .attach("photo", img, "photo.jpg");
    const del = await request(app).delete("/api/v1/me/profile/photo").set(auth(token));
    expect(del.status).toBe(204);
    const get = await request(app).get("/api/v1/me/profile").set(auth(token));
    expect(get.body.photo_url).toBeNull();
  });

  it("addresses CRUD: add (first is default), default handoff, edit, delete", async () => {
    const { token } = await authed();
    const a1 = {
      name: "Aasha Sharma", phone: "9841111111", city: "Kathmandu",
      address_line: "Baneshwor, House 12", label: "Home",
    };
    const r1 = await request(app).post("/api/v1/me/addresses").set(auth(token)).send(a1);
    expect(r1.status).toBe(201);
    expect(r1.body.address.is_default).toBe(true);

    const a2 = { ...a1, label: "Office", address_line: "Pulchowk, Block B" };
    const r2 = await request(app).post("/api/v1/me/addresses").set(auth(token)).send(a2);
    expect(r2.status).toBe(201);
    expect(r2.body.address.is_default).toBe(false);

    // Promote the second to default — the first loses it.
    const r3 = await request(app)
      .patch(`/api/v1/me/addresses/${r2.body.address.id}`)
      .set(auth(token))
      .send({ is_default: true });
    expect(r3.status).toBe(200);
    expect(r3.body.address.is_default).toBe(true);

    const list = await request(app).get("/api/v1/me/addresses").set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.addresses).toHaveLength(2);
    const defaults = list.body.addresses.filter((a: { is_default: boolean }) => a.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(r2.body.address.id);

    // Edit a field.
    const r4 = await request(app)
      .patch(`/api/v1/me/addresses/${r1.body.address.id}`)
      .set(auth(token))
      .send({ city: "Lalitpur" });
    expect(r4.status).toBe(200);
    expect(r4.body.address.city).toBe("Lalitpur");

    // Delete the non-default; 404 on unknown id.
    const d1 = await request(app).delete(`/api/v1/me/addresses/${r1.body.address.id}`).set(auth(token));
    expect(d1.status).toBe(204);
    const d2 = await request(app).delete("/api/v1/me/addresses/does-not-exist").set(auth(token));
    expect(d2.status).toBe(404);

    const list2 = await request(app).get("/api/v1/me/addresses").set(auth(token));
    expect(list2.body.addresses).toHaveLength(1);
    expect(list2.body.addresses[0].is_default).toBe(true);
  });

  it("POST /me/addresses validates required fields", async () => {
    const { token } = await authed();
    const bad = await request(app)
      .post("/api/v1/me/addresses")
      .set(auth(token))
      .send({ name: "", phone: "abc", city: "KTM" }); // missing address_line, bad phone
    expect(bad.status).toBe(400);
  });

  it("address isolation: users only see their own addresses", async () => {
    const { token } = await authed();
    const other = await store.createUser({ phone: "9842222222" });
    const otherToken = tokenFor(other);
    const a = { name: "X", phone: "9842222222", city: "KTM", address_line: "A1" };
    const r = await request(app).post("/api/v1/me/addresses").set(auth(otherToken)).send(a);
    expect(r.status).toBe(201);
    const mine = await request(app).get("/api/v1/me/addresses").set(auth(token));
    expect(mine.body.addresses).toEqual([]);
    // Cannot edit another user's address id.
    const nope = await request(app)
      .patch(`/api/v1/me/addresses/${r.body.address.id}`)
      .set(auth(token))
      .send({ city: "Pokhara" });
    expect(nope.status).toBe(404);
  });
});
