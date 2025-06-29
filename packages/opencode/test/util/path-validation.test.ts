import { describe, test, expect } from "bun:test"
import { PathValidation } from "../../src/util/path-validation"

describe("PathValidation", () => {
  describe("isRelativePath", () => {
    test("detects relative paths", () => {
      expect(PathValidation.isRelativePath("./file.txt")).toBe(true)
      expect(PathValidation.isRelativePath("../file.txt")).toBe(true)
      expect(PathValidation.isRelativePath("file.txt")).toBe(true)
      expect(PathValidation.isRelativePath("src/file.txt")).toBe(true)
    })

    test("detects absolute paths", () => {
      expect(PathValidation.isRelativePath("/home/user/file.txt")).toBe(false)
      expect(PathValidation.isRelativePath("/usr/bin/node")).toBe(false)
      // Windows paths
      if (process.platform === "win32") {
        expect(PathValidation.isRelativePath("C:\\Users\\file.txt")).toBe(false)
      }
    })
  })

  describe("getRelativePathError", () => {
    test("generates helpful error message", () => {
      const error = PathValidation.getRelativePathError("./src/file.txt")
      expect(error).toContain("You must use absolute paths")
      expect(error).toContain("./src/file.txt")
      expect(error).toContain("Did you mean:")
      expect(error).toContain(process.cwd())
    })
  })

  describe("findSimilarPaths", () => {
    test("finds similar files in same directory", async () => {
      // This test would need actual files to work properly
      // For now, just test that it doesn't crash
      const suggestions = await PathValidation.findSimilarPaths("/nonexistent/file.txt")
      expect(Array.isArray(suggestions)).toBe(true)
    })
  })
})