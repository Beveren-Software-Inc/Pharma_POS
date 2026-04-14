/**
 * GS1 DataMatrix / GS1-128 Parser
 *
 * Handles structured barcodes in multiple formats:
 *   1. Parentheses format:     (01)08002660032249(21)100285731569(17)270731(10)729323
 *   2. FNC1/GS format:         010084014965237717280131 10MP4022 211WNVHXXC68
 *   (with or without FNC1 / GS separators)
 */

export interface GS1ParsedData {
  gtin?: string          // AI 01 – 14 digits
  expiryDate?: string    // AI 17 – YYMMDD → parsed to "YYYY-MM-DD"
  lotNumber?: string     // AI 10 – variable length
  serialNumber?: string  // AI 21 – variable length
  raw: string            // original scanned string
  isGS1: boolean
}

/** ASCII group separator used as FNC1 in many scanners */
const GS = '\x1d'

/**
 * Fixed-length AI definitions (AI → exact field length after the 2-digit AI).
 * Variable-length AIs are handled separately.
 */
const FIXED_LENGTH_AI: Record<string, number> = {
  '01': 14, // GTIN
  '02': 14, // GTIN of contained trade items
  '11': 6,  // Production date YYMMDD
  '13': 6,  // Packaging date YYMMDD
  '15': 6,  // Best before date YYMMDD
  '17': 6,  // Expiry date YYMMDD
  '31': 8,  // Net weight / variable measure
  '32': 8,
  '33': 8,
  '34': 8,
  '35': 8,
  '36': 8,
}

/** Variable-length AIs we care about (max length per GS1 spec) */
const VARIABLE_LENGTH_AI: Record<string, number> = {
  '10': 20, // Batch / Lot
  '21': 20, // Serial number
  '240': 30,
  '241': 30,
  '250': 30,
  '251': 30,
  '253': 30,
  '254': 20,
  '30': 8,
  '37': 8,
  '400': 30,
  '401': 30,
  '402': 17,
  '403': 30,
  '410': 13,
  '411': 13,
  '412': 13,
  '413': 13,
  '414': 13,
  '415': 13,
  '420': 20,
  '421': 15,
  '422': 3,
  '710': 20,
  '711': 20,
  '712': 20,
  '713': 20,
  '714': 20,
}

function formatExpiryDate(yymmdd: string): string {
  if (yymmdd.length !== 6) return yymmdd
  const yy = yymmdd.substring(0, 2)
  const mm = yymmdd.substring(2, 4)
  const dd = yymmdd.substring(4, 6)
  const year = parseInt(yy, 10) >= 50 ? `19${yy}` : `20${yy}`
  return `${year}-${mm}-${dd}`
}

/**
 * Detects if the code is in parentheses format: (01)value(10)batch(17)expiry(21)serial
 */
function isParenthesesFormat(code: string): boolean {
  return /^\(\d{2}\)/.test(code.trim())
}

/**
 * Parses GS1 code in parentheses format.
 * Example: (01)08002660032249(21)100285731569(17)270731(10)729323
 *
 * Returns parsed data with gtin, lotNumber (batch), serialNumber, and expiryDate.
 */
function parseParenthesesGS1(raw: string): GS1ParsedData {
  const result: GS1ParsedData = { raw, isGS1: false }
  
  try {
    // Pattern to find all (AI)value pairs where AI is 2 digits
    const pattern = /\((\d{2})\)([^\(]*)/g
    let match
    
    while ((match = pattern.exec(raw)) !== null) {
      const ai = match[1]
      const value = match[2].trim()
      
      if (!value) continue
      
      switch (ai) {
        case '01':
          result.gtin = value
          break
        case '10':
          result.lotNumber = value
          break
        case '17':
          result.expiryDate = formatExpiryDate(value)
          break
        case '21':
          result.serialNumber = value
          break
        // Add other AIs as needed
      }
    }
    
    if (result.gtin || result.lotNumber || result.serialNumber || result.expiryDate) {
      result.isGS1 = true
    }
  } catch (e) {
    // If parsing fails, return the default result
  }
  
  return result
}

/**
 * Returns true when the string looks like it could be a GS1 compound code.
 * Heuristic: starts with a known 2-digit AI ("01", "10", "17", "21") optionally
 * preceded by "]d2" / "]C1" symbology identifiers.
 */
export function looksLikeGS1(code: string): boolean {
  // Check for parentheses format first
  if (isParenthesesFormat(code)) {
    return true
  }
  
  // Strip common symbology identifier prefixes
  const stripped = code.replace(/^\]([dCeQ][0-9A-Za-z]|d[0-9])/, '')
  return /^(01|10|17|21|00|02|11|13|15|30|37|240|241|250|251|253|254|400|401|402|403|410|411|412|413|414|415|420|421|422|710|711|712|713|714)/.test(stripped)
}

export function parseGS1(raw: string): GS1ParsedData {
  const result: GS1ParsedData = { raw, isGS1: false }

  if (!raw || raw.length < 4) return result

  // Try parentheses format first: (01)value(10)batch(17)expiry(21)serial
  if (isParenthesesFormat(raw)) {
    return parseParenthesesGS1(raw)
  }

  // Strip symbology identifiers like ]d2, ]C1, ]e0, ]Q3
  let data = raw.replace(/^\]([dCeQ][0-9A-Za-z]|d[0-9])/, '')

  // Replace GS (ASCII 29) separators with a placeholder we can work with
  data = data.replace(new RegExp(GS, 'g'), GS)

  if (!looksLikeGS1(data)) return result

  result.isGS1 = true

  let pos = 0

  while (pos < data.length) {
    // Skip any GS separator character
    if (data[pos] === GS) {
      pos++
      continue
    }

    // Try 3-digit AI first (some AIs are 3 digits)
    let ai = data.substring(pos, pos + 3)
    let aiLength = 3

    // Fall back to 2-digit AI
    if (FIXED_LENGTH_AI[ai] === undefined && VARIABLE_LENGTH_AI[ai] === undefined) {
      ai = data.substring(pos, pos + 2)
      aiLength = 2
    }

    if (!ai || aiLength > data.length - pos) break

    pos += aiLength

    if (FIXED_LENGTH_AI[ai] !== undefined) {
      // Fixed-length field
      const fieldLen = FIXED_LENGTH_AI[ai]
      const value = data.substring(pos, pos + fieldLen)
      pos += fieldLen

      switch (ai) {
        case '01': result.gtin = value; break
        case '17': result.expiryDate = formatExpiryDate(value); break
      }
    } else if (VARIABLE_LENGTH_AI[ai] !== undefined) {
      // Variable-length field: read until GS separator, next AI, or max length
      const maxLen = VARIABLE_LENGTH_AI[ai]
      const gsPos = data.indexOf(GS, pos)
      let end: number

      if (gsPos !== -1 && gsPos - pos <= maxLen) {
        end = gsPos
      } else {
        // Without a GS separator, variable-length field boundaries are
        // inherently ambiguous per GS1 spec (GS separators are required).
        //
        // We resolve this with a whitelist of AIs that are common on product
        // labels and whose 2-digit codes are unambiguous (i.e. they won't
        // appear as a digit-substring inside a typical lot/serial value):
        //   01 GTIN, 11 prod-date, 13 pack-date, 15 best-before,
        //   17 expiry, 21 serial
        //
        // Crucially, we exclude AIs like 400-415, 420-422 whose codes
        // are often substrings of alphanumeric lot values (e.g. "40" in "MP4022").
        //
        // Scan forward; stop at the FIRST position where one of these
        // unambiguous AIs begins and the remaining data satisfies its length.
        const BOUNDARY_AIS: Array<[string, number | 'var']> = [
          ['01', 14], ['11', 6], ['13', 6], ['15', 6], ['17', 6],  // fixed
          ['10', 'var'], ['21', 'var'], ['30', 'var'], ['37', 'var'], // variable
          ['240', 'var'], ['241', 'var'], ['250', 'var'], ['251', 'var'],
        ]

        end = pos + maxLen
        for (let look = pos + 1; look < Math.min(pos + maxLen, data.length - 1); look++) {
          if (!/[0-9]/.test(data[look])) continue

          for (const [boundaryAI, len] of BOUNDARY_AIS) {
            const slice = data.substring(look, look + boundaryAI.length)
            if (slice !== boundaryAI) continue

            const afterAI = look + boundaryAI.length
            const remaining = data.length - afterAI
            const valid = len === 'var' ? remaining >= 1 : remaining >= len
            if (valid) { end = look; break }
          }

          if (end !== pos + maxLen) break // found boundary
        }
      }

      const value = data.substring(pos, end)
      pos = end

      switch (ai) {
        case '10': result.lotNumber = value; break
        case '21': result.serialNumber = value; break
      }
    } else {
      // Unknown AI – skip one character and try to re-sync
      pos++
    }
  }

  return result
}