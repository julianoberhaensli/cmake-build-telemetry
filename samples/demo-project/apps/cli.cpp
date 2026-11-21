#include <iostream>
#include <string>
#include <vector>

namespace text {
bool matches_any(const std::string&);
std::vector<std::string> tokens(const std::string&);
}  // namespace text
namespace numeric {
long long meta_value();
}

int main(int argc, char** argv) {
  const std::string in = argc > 1 ? argv[1] : "hello world 123";
  std::cout << text::tokens(in).size() << " tokens, match=" << text::matches_any(in)
            << ", meta=" << numeric::meta_value() << "\n";
  return 0;
}
