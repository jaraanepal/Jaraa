/**
 * v14 — DoctorCase workflow tests (Problem 3):
 * - hardened "Not found" path: 404 vs server error, always a back-to-queue link
 * - scan-fetch fallback: the case renders from the case payload when the
 *   owner-only /scans/:id fetch fails for the doctor
 * - Kahani answers visible from the case payload
 * - structured prescription: validation, serialization into the plan payload
 * - kit attach persists the kit_id in the plan payload
 * - follow-up scheduling from the case page
 * - submit: compose → approve → case refetch (status flips to Reviewed)
 *
 * All API modules are mocked; no network.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LanguageProvider } from "../i18n/LanguageContext";
import DoctorCase from "../pages/doctor/DoctorCase";
import { ApiError } from "../api/types";

const mocks = vi.hoisted(() => {
  const doctorApi = {
    getCase: vi.fn(),
    getCaseScan: vi.fn(),
    claimCase: vi.fn(),
    annotatePhoto: vi.fn(),
    composePlan: vi.fn(),
    approvePlan: vi.fn(),
    patientCases: vi.fn(),
    listFollowUps: vi.fn(),
    createFollowUp: vi.fn(),
    completeFollowUp: vi.fn(),
    listBookmarks: vi.fn(),
    bookmarkCase: vi.fn(),
    unbookmarkCase: vi.fn(),
    listSnippets: vi.fn(),
    getChecklist: vi.fn(),
    createChecklist: vi.fn(),
    setChecklistItemDone: vi.fn(),
    createPhotoRequest: vi.fn(),
  };
  const shopApi = { listKits: vi.fn() };
  const doctorB3Api = {
    archiveCase: vi.fn(),
    requestSecondOpinion: vi.fn(),
    transferCase: vi.fn(),
  };
  const doctorB4Api = {
    needsInfo: vi.fn(),
    listComments: vi.fn(),
    addComment: vi.fn(),
    listConcerns: vi.fn(),
    addConcern: vi.fn(),
    removeConcern: vi.fn(),
    priorityHistory: vi.fn(),
    similarCases: vi.fn(),
    listMessages: vi.fn(),
    sendMessage: vi.fn(),
    shareSummary: vi.fn(),
    pauseSla: vi.fn(),
    resumeSla: vi.fn(),
  };
  return { doctorApi, shopApi, doctorB3Api, doctorB4Api };
});

vi.mock("../api/client", () => ({
  doctorApi: mocks.doctorApi,
  shopApi: mocks.shopApi,
}));
vi.mock("../api/b3doctor", () => ({ doctorB3Api: mocks.doctorB3Api }));
vi.mock("../api/b4doctor", () => ({ doctorB4Api: mocks.doctorB4Api }));

const CASE = {
  id: "case-1",
  scan_id: "scan-1",
  user_id: "user-1",
  assigned_doctor_id: "doc-1",
  priority: "normal",
  sla_due_at: "2030-01-01T00:00:00.000Z",
  status: "in_review",
  created_at: "2026-09-20T00:00:00.000Z",
  archived_at: null,
  // v14: the case payload carries the scan context inline.
  scan: {
    id: "scan-1",
    status: "submitted",
    answers: { sleep_hours: 5, itching: true, thinning_area: "crown" },
    version: 1,
  },
  timeline_events: [],
  photos: [],
  root_scores: [],
  red_flags: [],
};

const SCAN = {
  id: "scan-1",
  status: "submitted",
  current_stage: "root_map",
  stages_completed: [],
  version: 1,
  red_flags_count: 0,
  created_at: "2026-09-20T00:00:00.000Z",
  updated_at: "2026-09-20T00:00:00.000Z",
  timeline_events: [],
  photos: [],
  root_scores: null,
  red_flags: [],
};

function mockNotFound() {
  return new ApiError(404, { code: "not_found", message: "Not found." });
}

beforeEach(() => {
  localStorage.setItem("jaraa:lang", "en");
  vi.clearAllMocks();
  const { doctorApi, shopApi, doctorB4Api } = mocks;
  doctorApi.getCase.mockResolvedValue({ ...CASE });
  doctorApi.getCaseScan.mockResolvedValue({ ...SCAN });
  doctorApi.listBookmarks.mockResolvedValue({ case_ids: [] });
  doctorApi.listSnippets.mockResolvedValue({ snippets: [] });
  doctorApi.getChecklist.mockResolvedValue({ checklist: null });
  doctorApi.patientCases.mockResolvedValue({ cases: [] });
  doctorApi.listFollowUps.mockResolvedValue({ follow_ups: [] });
  doctorApi.composePlan.mockResolvedValue({ id: "plan-1" });
  doctorApi.approvePlan.mockResolvedValue({ id: "plan-1", status: "approved" });
  shopApi.listKits.mockResolvedValue({ kits: [] });
  doctorB4Api.needsInfo.mockResolvedValue({ photo_requests: [] });
  doctorB4Api.listComments.mockResolvedValue({ comments: [] });
  doctorB4Api.listConcerns.mockResolvedValue({ concerns: [], allowed_tags: [] });
  doctorB4Api.priorityHistory.mockResolvedValue({ history: [] });
  doctorB4Api.similarCases.mockResolvedValue({ similar: [] });
  doctorB4Api.listMessages.mockResolvedValue({ messages: [] });
});

afterEach(() => {
  localStorage.removeItem("jaraa:lang");
});

function renderCase() {
  return render(
    <MemoryRouter initialEntries={["/doctor/case/case-1"]}>
      <LanguageProvider>
        <Routes>
          <Route path="/doctor/case/:id" element={<DoctorCase />} />
          <Route path="/doctor" element={<div>review queue page</div>} />
        </Routes>
      </LanguageProvider>
    </MemoryRouter>,
  );
}

describe("DoctorCase — hardened case-load path", () => {
  it("shows a 'Case not found' card with a back-to-queue link on 404", async () => {
    mocks.doctorApi.getCase.mockRejectedValueOnce(mockNotFound());
    renderCase();
    expect(await screen.findByText("Case not found")).toBeTruthy();
    expect(screen.getByText(/may have been deleted/i)).toBeTruthy();
    const back = screen.getByRole("link", { name: /back to queue/i });
    expect(back.getAttribute("href")).toBe("/doctor");
    // no retry on a 404 — the case genuinely does not exist
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });

  it("shows a retryable error card (not 'not found') on server errors", async () => {
    mocks.doctorApi.getCase.mockRejectedValueOnce(
      new ApiError(500, { code: "unknown", message: "Boom." } as any),
    );
    renderCase();
    expect(await screen.findByText("Couldn't load this case")).toBeTruthy();
    expect(screen.queryByText("Case not found")).toBeNull();
    const retry = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.doctorApi.getCase).toHaveBeenCalledTimes(2));
    // still a way back to the queue
    expect(screen.getByRole("link", { name: /back to queue/i }).getAttribute("href")).toBe("/doctor");
  });

  it("renders the case from the case payload when the scan fetch fails (no dead end)", async () => {
    mocks.doctorApi.getCaseScan.mockRejectedValueOnce(mockNotFound());
    renderCase();
    // the case header renders (scan id slice) instead of the pink dead end
    expect(await screen.findByText("scan-1")).toBeTruthy();
    expect(screen.getByText("Limited case view")).toBeTruthy();
    expect(screen.queryByText("Case not found")).toBeNull();
  });

  it("shows the patient's Kahani answers from the case payload", async () => {
    mocks.doctorApi.getCaseScan.mockRejectedValueOnce(mockNotFound());
    renderCase();
    expect(await screen.findByText("Patient answers")).toBeTruthy();
    expect(screen.getByText("Sleep per night")).toBeTruthy();
    expect(screen.getByText("5 hours")).toBeTruthy();
    expect(screen.getByText("Itching")).toBeTruthy();
    expect(screen.getByText("Thinning area")).toBeTruthy();
    expect(screen.getByText("crown")).toBeTruthy();
  });
});

describe("DoctorCase — structured prescription", () => {
  it("blocks submit when a medicine row has dosage but no name", async () => {
    renderCase();
    await screen.findByText("Prescription");
    fireEvent.change(screen.getByPlaceholderText(/dosage — e.g/i), {
      target: { value: "1 tablet daily" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    expect(await screen.findByText(/a medicine needs a name/i)).toBeTruthy();
    expect(mocks.doctorApi.composePlan).not.toHaveBeenCalled();
  });

  it("serializes diagnosis + medicines + instructions into the plan payload, then approves", async () => {
    renderCase();
    await screen.findByText("Prescription");

    fireEvent.change(screen.getByPlaceholderText(/diagnosis — e.g/i), {
      target: { value: "Androgenetic alopecia" },
    });
    fireEvent.change(screen.getByPlaceholderText("Medicine name"), {
      target: { value: "Minoxidil" },
    });
    fireEvent.change(screen.getByPlaceholderText(/dosage — e.g/i), {
      target: { value: "5% twice daily" },
    });
    fireEvent.change(screen.getByPlaceholderText(/duration — e.g/i), {
      target: { value: "90 days" },
    });
    fireEvent.change(screen.getByPlaceholderText(/instruction — e.g/i), {
      target: { value: "Wash hair twice a week" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(mocks.doctorApi.composePlan).toHaveBeenCalledTimes(1));
    const payload = mocks.doctorApi.composePlan.mock.calls[0][1] as {
      items: { kind: string; title_en: string; detail?: string; kit_id?: string }[];
      review_notes?: string;
    };
    const med = payload.items.find((i) => i.title_en === "Minoxidil");
    expect(med).toBeTruthy();
    expect(med!.kind).toBe("product");
    expect(med!.detail).toBe("Dosage: 5% twice daily · Duration: 90 days");
    const instr = payload.items.find((i) => i.title_en === "Wash hair twice a week");
    expect(instr).toBeTruthy();
    expect(instr!.kind).toBe("habit");
    expect(payload.review_notes).toContain("Diagnosis: Androgenetic alopecia");

    await waitFor(() => expect(mocks.doctorApi.approvePlan).toHaveBeenCalledWith("plan-1"));
    // the case is refetched so the status chip flips to Reviewed
    await waitFor(() => expect(mocks.doctorApi.getCase).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Approved — sent to the patient")).toBeTruthy();
  });

  it("persists the attached kit_id in the plan payload", async () => {
    mocks.shopApi.listKits.mockResolvedValue({
      kits: [{ id: "kit-1", name: "Starter Kit", total_npr: 1500, is_active: true, products: [] }],
    });
    renderCase();
    await screen.findByText("Prescription");

    // switch the composer item to a product so the kit picker appears
    fireEvent.change(screen.getByLabelText("Habit"), { target: { value: "product" } });
    fireEvent.change(await screen.findByLabelText("Attach kit"), { target: { value: "kit-1" } });
    // the attached-kit indicator appears
    expect(await screen.findByText(/attached to this plan/i)).toBeTruthy();

    // give the item a title so it is submittable
    fireEvent.change(screen.getByPlaceholderText(/action in plain language/i), {
      target: { value: "Use the kit as directed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(mocks.doctorApi.composePlan).toHaveBeenCalledTimes(1));
    const payload = mocks.doctorApi.composePlan.mock.calls[0][1] as {
      items: { kind: string; kit_id?: string }[];
    };
    expect(payload.items.some((i) => i.kit_id === "kit-1")).toBe(true);
  });
});

describe("DoctorCase — follow-up scheduling", () => {
  it("schedules a follow-up for this case and lists it", async () => {
    mocks.doctorApi.createFollowUp.mockResolvedValue({
      id: "fu-1", case_id: "case-1", doctor_id: "doc-1",
      due_on: "2030-02-01", note: "recheck shedding",
      done_at: null, created_at: "2026-09-27T00:00:00.000Z",
    });
    renderCase();
    await screen.findByText("Follow-ups");

    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2030-02-01" } });
    fireEvent.change(screen.getByPlaceholderText(/note \(optional\)/i), {
      target: { value: "recheck shedding" },
    });
    fireEvent.click(screen.getByRole("button", { name: /schedule follow-up/i }));

    await waitFor(() => expect(mocks.doctorApi.createFollowUp).toHaveBeenCalledTimes(1));
    expect(mocks.doctorApi.createFollowUp).toHaveBeenCalledWith({
      case_id: "case-1",
      due_on: "2030-02-01",
      note: "recheck shedding",
    });
    // the new follow-up shows in this case's list
    expect(await screen.findByText("2030-02-01")).toBeTruthy();
  });

  it("marks a follow-up done and removes it from the list", async () => {
    mocks.doctorApi.listFollowUps.mockResolvedValue({
      follow_ups: [{
        id: "fu-9", case_id: "case-1", doctor_id: "doc-1",
        due_on: "2030-03-01", note: "old",
        done_at: null, created_at: "2026-09-27T00:00:00.000Z",
      }],
    });
    mocks.doctorApi.completeFollowUp.mockResolvedValue({});
    renderCase();
    await screen.findByText("2030-03-01");
    fireEvent.click(screen.getByRole("button", { name: /mark done/i }));
    await waitFor(() => expect(mocks.doctorApi.completeFollowUp).toHaveBeenCalledWith("fu-9"));
    await waitFor(() => expect(screen.queryByText("2030-03-01")).toBeNull());
  });
});

describe("DoctorCase — claim from the case page", () => {
  it("offers Claim on an unassigned queued case", async () => {
    mocks.doctorApi.getCase.mockResolvedValue({
      ...CASE, status: "queued", assigned_doctor_id: null,
    });
    mocks.doctorApi.claimCase.mockResolvedValue({
      ...CASE, status: "in_review", assigned_doctor_id: "doc-1",
    });
    renderCase();
    const claim = await screen.findByRole("button", { name: /^claim$/i });
    fireEvent.click(claim);
    await waitFor(() => expect(mocks.doctorApi.claimCase).toHaveBeenCalledWith("case-1"));
  });
});
