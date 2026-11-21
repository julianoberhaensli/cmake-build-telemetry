// <regex> is notoriously slow to compile - a realistic hotspot.
#include <regex>
#include <string>
#include <vector>

namespace text {
bool matches_any(const std::string& s) {
  static const std::vector<std::regex> rules = {
      std::regex("[a-z]+[0-9]*"), std::regex("^(foo|bar)+$"), std::regex("\\d{3}-\\d{4}"),
      std::regex("([A-Z][a-z]+ ?)+"), std::regex("[[:alpha:]]+@[[:alpha:]]+\\.com")};
  for (const auto& r : rules) {
    if (std::regex_match(s, r)) return true;
  }
  std::wregex w(L"[a-z]+");
  return std::regex_search(std::wstring(s.begin(), s.end()), w);
}
}  // namespace text
