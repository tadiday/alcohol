# alcohol

Standalone prototype for assisting alcohol beverage label reviews by comparing label artwork against application data. Working project name: `alcohol`.

## Project status

Repository initialized. Application implementation, stack selection, and deployment are pending; there are no setup or run commands yet.

## Intended workflow

1. Enter application data and upload label artwork.
2. Extract label information and compare it with the application.
3. Show clear matches, discrepancies, and items requiring human review.

## Requirements from discovery

- Compare brand name, class/type, alcohol content, net contents, producer/bottler name and address, and country of origin for imports, as applicable.
- Allow harmless differences such as brand-name capitalization while flagging meaningful discrepancies.
- Check government warning wording and inspect capitalization and bold styling of the heading. Verify applicable requirements against authoritative TTB guidance during implementation.
- Target results in approximately five seconds per label; measure actual performance before claiming this target is met.
- Provide a simple, accessible interface with obvious actions and helpful error messages.
- Keep agents responsible for final review, particularly for uncertain extraction and nuanced cases.

## Additional opportunities

- Batch processing for submissions of 200–300 applications.
- Improved handling of angled images, poor lighting, and glare.

## Constraints and assumptions

- Standalone proof of concept; no direct COLA integration.
- No sensitive production data is required for the prototype.
- Network restrictions may prevent access to external AI endpoints; document endpoint dependencies and failures clearly.
- Requirements vary by beverage type. Discovery notes are a product brief, not a verified regulatory specification.

## Expected deliverables

- Working source code and setup/run instructions.
- Documentation of approach, tools, assumptions, and limitations.
- A deployed prototype URL.
- Sample labels and meaningful validation of the comparison workflow.

Prefer a complete core workflow over incomplete advanced features.
