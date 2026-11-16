; Shared JSON string decoding used by backend messages and Button input caches.
JsonStringValue(raw, key) {
    pattern := '"' key '"\s*:\s*"((?:\\.|[^"\\])*)"'
    if RegExMatch(raw, pattern, &match)
        return JsonUnescape(match[1])
    return ""
}

JsonUnescape(value) {
    output := ""
    index := 1
    length := StrLen(value)
    while index <= length {
        char := SubStr(value, index, 1)
        if char != "\" {
            output .= char
            index += 1
            continue
        }

        index += 1
        if index > length {
            output .= "\"
            break
        }

        escaped := SubStr(value, index, 1)
        switch escaped {
            case '"':
                output .= '"'
            case "\":
                output .= "\"
            case "/":
                output .= "/"
            case "b":
                output .= Chr(8)
            case "f":
                output .= Chr(12)
            case "n":
                output .= "`n"
            case "r":
                output .= "`r"
            case "t":
                output .= "`t"
            default:
                output .= escaped
        }
        index += 1
    }
    return output
}
