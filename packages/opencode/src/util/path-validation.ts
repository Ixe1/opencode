import * as path from "path"
import * as fs from "fs"
import { glob } from "glob"

export namespace PathValidation {
  /**
   * Check if a path is relative
   */
  export function isRelativePath(filePath: string): boolean {
    return !path.isAbsolute(filePath)
  }

  /**
   * Generate an error message for relative paths
   */
  export function getRelativePathError(filePath: string): string {
    const cwd = process.cwd()
    const suggestedPath = path.join(cwd, filePath)
    
    return `Error: You must use absolute paths, not relative paths.
    
You provided: "${filePath}" (relative path)
Did you mean: "${suggestedPath}" (absolute path)?

Remember:
- Always use absolute paths starting with / (Unix/Mac) or C:\\ (Windows)
- Current working directory: ${cwd}
- To convert a relative path to absolute, prepend the current directory`
  }

  /**
   * Find similar paths when a file doesn't exist
   */
  export async function findSimilarPaths(targetPath: string, maxSuggestions: number = 5): Promise<string[]> {
    const dir = path.dirname(targetPath)
    const basename = path.basename(targetPath)
    const suggestions: Array<{ path: string; score: number }> = []

    try {
      // First, check if the directory exists
      if (!fs.existsSync(dir)) {
        // If directory doesn't exist, try to find similar directories
        const parentDir = path.dirname(dir)
        if (fs.existsSync(parentDir)) {
          const dirs = fs.readdirSync(parentDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => path.join(parentDir, dirent.name))
          
          for (const similarDir of dirs) {
            const similarity = calculateSimilarity(dir, similarDir)
            if (similarity > 0.5) {
              // Check if a file with the same basename exists in this directory
              const potentialPath = path.join(similarDir, basename)
              if (fs.existsSync(potentialPath)) {
                suggestions.push({ path: potentialPath, score: similarity + 0.5 })
              }
            }
          }
        }
      } else {
        // Directory exists, look for similar files
        const files = fs.readdirSync(dir)
        
        for (const file of files) {
          const fullPath = path.join(dir, file)
          const similarity = calculateSimilarity(basename.toLowerCase(), file.toLowerCase())
          
          if (similarity > 0.3) {
            suggestions.push({ path: fullPath, score: similarity })
          }
        }
      }

      // Also try glob patterns for common variations
      const baseWithoutExt = path.basename(basename, path.extname(basename))
      const ext = path.extname(basename)
      
      const patterns = [
        path.join(dir, `*${baseWithoutExt}*${ext}`),
        path.join(dir, `${baseWithoutExt}*`),
        path.join(path.dirname(dir), `**/${basename}`),
      ]

      for (const pattern of patterns) {
        try {
          const matches = await glob(pattern, { 
            ignore: ['**/node_modules/**', '**/.git/**'],
            maxDepth: 3 
          })
          for (const match of matches) {
            const similarity = calculateSimilarity(targetPath, match)
            suggestions.push({ path: match, score: similarity })
          }
        } catch (e) {
          // Ignore glob errors
        }
      }

      // Sort by score and remove duplicates
      const uniquePaths = new Set<string>()
      return suggestions
        .sort((a, b) => b.score - a.score)
        .filter(s => {
          if (uniquePaths.has(s.path)) return false
          uniquePaths.add(s.path)
          return true
        })
        .slice(0, maxSuggestions)
        .map(s => s.path)

    } catch (error) {
      return []
    }
  }

  /**
   * Calculate similarity between two strings (0-1)
   */
  function calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2
    const shorter = str1.length > str2.length ? str2 : str1
    
    if (longer.length === 0) return 1.0
    
    const editDistance = levenshteinDistance(longer, shorter)
    return (longer.length - editDistance) / longer.length
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  function levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = []
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i]
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1]
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          )
        }
      }
    }
    
    return matrix[str2.length][str1.length]
  }

  /**
   * Generate error message with path suggestions
   */
  export async function getPathNotFoundError(filePath: string): Promise<string> {
    const suggestions = await findSimilarPaths(filePath, 3)
    
    let errorMsg = `File not found: ${filePath}`
    
    if (suggestions.length > 0) {
      errorMsg += `\n\nDid you mean one of these?\n${suggestions.join('\n')}`
    } else {
      errorMsg += `\n\nPlease verify:\n- The path is correct and absolute\n- The file exists\n- You have permission to access it`
    }
    
    return errorMsg
  }
}