package expo.modules.nativeepubreader

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GluedVerseNumberTest {
  private fun split(token: String, probe: Int) = splitGluedVerseNumber(token, 0, token.length, probe)

  @Test
  fun tapOnTheWordPicksTheWord() {
    assertEquals(2 until 6, split("26Then", 3))
    assertEquals(1 until 4, split("4and", 2))
    assertEquals(1 until 3, split("1In", 1))
  }

  @Test
  fun tapOnTheNumberPicksTheNumber() {
    assertEquals(0 until 2, split("26Then", 1))
  }

  @Test
  fun wordsThatStartWithANumberStayWhole() {
    listOf("2nd", "4th", "90s", "10am", "5km", "3D", "100mph", "5in", "1984George", "26").forEach {
      assertNull(it, split(it, it.length - 1))
    }
  }
}
