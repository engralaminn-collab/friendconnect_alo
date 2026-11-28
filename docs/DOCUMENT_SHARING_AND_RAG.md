# Document sharing and document RAG — status

Status as of 2026-11-28 (branch `arena/2b2a87d0-friendconnect-alo`, `b6248b6`).

| Item | Status |
|---|---|
| File upload, metadata, ownership, FileAccess grants, conversation and group access, validated download | Implemented and tested (see `REMEDIATION_MATRIX.md`, findings 10, 27). |
| Approved-knowledge BM25 RAG-lite (`search_knowledge`) | Implemented for approved knowledge only. It is **not** document intelligence over user files. |
| Sharing a user's document with Jara and answering from it | **Not implemented.** |
| Permission-aware indexing of user documents, source citations, revocation and deletion for AI context | **Not implemented.** |
| Text extraction for PDF, DOCX, XLSX, PPTX | **Not implemented** (no extraction pipeline in the repository). |

Hard rule for any future implementation: document text is untrusted input. It must never override system permissions, and a user's private documents must never enter another user's AI context.
