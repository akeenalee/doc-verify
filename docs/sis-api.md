# UniVerify SIS API

Version 1. This is the one endpoint a school's student information system (SIS) exposes so UniVerify can check, at the moment of issuing, that a document is going to a registered student, and fill the issue form from the school's own record.

UniVerify only reads. It asks for one student at a time, by matric number, when a member of the Registry staff issues a document. It never asks for lists, never stores the answer beyond the document it prints, and never shows the answer to verifiers or graduates.

## Endpoint

```
GET {base_url}/students/{matric_number}
Accept: application/json
Authorization: Bearer {token}        (or Basic, see below)
User-Agent: UniVerify-SIS-Client/1
```

* `base_url` is whatever the school gives us, for example `https://sis.example.edu.ng/univerify`. It must be HTTPS and reachable on the public internet.
* `matric_number` is URL-encoded, so `CSC/2019/0012` arrives as `CSC%2F2019%2F0012`. Match it case-insensitively.
* UniVerify waits up to the timeout the school sets (default 5 seconds, maximum 15) and doesn't follow redirects.

## Authentication

One of:

* **Bearer token** (recommended): `Authorization: Bearer <token>`. Issue a long random token used only by UniVerify.
* **Basic**: `Authorization: Basic base64(username:password)`.
* **None**: for testing only.

The school's Owner enters the token in the UniVerify workspace under *Student records*. It's stored encrypted (AES-256-GCM, a key per school) and can't be read back by anyone.

Restrict the endpoint to read-only access for these fields. If the SIS sits behind a firewall, allow UniVerify's outbound addresses only.

## Responses

### 200: student found

```json
{
  "matric_number": "CSC/2019/0012",
  "full_name": "Adebayo Oluwaseun Tunde",
  "programme": "Bachelor of Science (B.Sc.) Computer Science",
  "faculty": "Science",
  "department": "Computer Science",
  "degree_class": "First Class",
  "entry_year": "2019",
  "graduation_year": "2023",
  "status": "graduated"
}
```

| Field | Required | Notes |
|---|---|---|
| `full_name` | yes | As it should appear on documents. Word order doesn't matter for the name check. |
| `matric_number` | recommended | If present, it must be the number asked for, or UniVerify rejects the answer. |
| `status` | recommended | See below. Without it, UniVerify can't stop an award going to a student who hasn't finished. |
| `programme`, `faculty`, `department` | no | Up to 200 characters each. |
| `degree_class` | no | `class_of_degree` is accepted too. |
| `entry_year`, `graduation_year` | no | Four digits. |

Any other fields are ignored. Keep the body under 20 kB.

Once a student is found, the record is the authority. UniVerify prints the record's name, programme, faculty, department, class and years, and staff can't change them. The issue form shows them greyed out, and the server ignores any other values that are sent. A name that doesn't match the record blocks issue. Fields the record leaves empty can be filled in by staff. To correct a detail, correct it in the SIS.

### 404: no such student

Any body. UniVerify then checks the school's uploaded student lists, if any.

### Anything else

Any other status, a timeout, a body that isn't JSON or has no `full_name` is treated as "SIS unavailable". Staff see the error, and the school's Owner sees the last error on the *Student records* page. If the school only issues to registered students, issuing waits until the SIS answers or the student is on an uploaded list.

## Status values

| Status | Awards (Certificate, Diploma, Completion) | Records of study (Transcript, Statement of Results, Attestation, others) |
|---|---|---|
| `graduated`, `completed`, `alumni`, `alumnus` | Allowed | Allowed |
| `enrolled`, `active`, or any other in-study value | Refused | Allowed (a student transferring abroad needs a transcript mid-programme) |
| `withdrawn`, `expelled`, `rusticated`, `suspended`, `deceased`, `transferred` | Refused | Allowed with a warning for staff to check |
| missing | Allowed | Allowed |

## Trying it without a real SIS

UniVerify ships a test SIS with 28 invented students. Start the app with `MOCK_SIS_ENABLED=1` (and, in production, `MOCK_SIS_TOKEN` set to a random string of at least 24 characters). It answers at `/mock-sis/students/{matric}` with bearer token `MOCK_SIS_TOKEN` (`test-sis-token` when not in production). The students are in `src/mock/sis-students.json`. These matric numbers simulate failures: `TEST/SLOW` (no answer for 20 seconds), `TEST/ERROR` (500), `TEST/MISMATCH` (answers for another student), `TEST/NONAME` (no `full_name`).
